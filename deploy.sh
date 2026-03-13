#!/bin/bash
# ===== スキルの書 — GCP Deploy Script =====
# Prerequisites: gcloud CLI authenticated, project set
# Usage: ./deploy.sh <PROJECT_ID> [REGION]

set -e

PROJECT_ID=${1:?"Usage: ./deploy.sh <PROJECT_ID> [REGION]"}
REGION=${2:-"asia-northeast1"}  # Tokyo
SERVICE_NAME="skillbook-api"

echo "📖 スキルの書 — Deploying to GCP"
echo "   Project: $PROJECT_ID"
echo "   Region:  $REGION"
echo ""

# ===== 1. Enable required APIs =====
echo "🔧 Enabling GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project="$PROJECT_ID"

# ===== 2. Create Firestore database (if not exists) =====
echo "🗄️  Setting up Firestore..."
gcloud firestore databases create \
  --project="$PROJECT_ID" \
  --location="$REGION" \
  --type=firestore-native 2>/dev/null || echo "   Firestore already exists, skipping."

# ===== 3. Create Firestore indexes =====
echo "📋 Creating Firestore indexes..."
cat > /tmp/firestore.indexes.json << 'INDEXES'
{
  "indexes": [
    {
      "collectionGroup": "skills",
      "queryScope": "COLLECTION",
      "fields": [
        {"fieldPath": "category", "order": "ASCENDING"},
        {"fieldPath": "installs", "order": "DESCENDING"}
      ]
    },
    {
      "collectionGroup": "skills",
      "queryScope": "COLLECTION",
      "fields": [
        {"fieldPath": "agents", "arrayConfig": "CONTAINS"},
        {"fieldPath": "installs", "order": "DESCENDING"}
      ]
    },
    {
      "collectionGroup": "skills",
      "queryScope": "COLLECTION",
      "fields": [
        {"fieldPath": "rarity", "order": "ASCENDING"},
        {"fieldPath": "installs", "order": "DESCENDING"}
      ]
    },
    {
      "collectionGroup": "skillsets",
      "queryScope": "COLLECTION",
      "fields": [
        {"fieldPath": "author", "order": "ASCENDING"},
        {"fieldPath": "installs", "order": "DESCENDING"}
      ]
    },
    {
      "collectionGroup": "reviews",
      "queryScope": "COLLECTION",
      "fields": [
        {"fieldPath": "targetId", "order": "ASCENDING"},
        {"fieldPath": "createdAt", "order": "DESCENDING"}
      ]
    }
  ],
  "fieldOverrides": []
}
INDEXES

gcloud firestore indexes composite create \
  --project="$PROJECT_ID" \
  --collection-group=skills \
  --field-config=field-path=category,order=ascending \
  --field-config=field-path=installs,order=descending 2>/dev/null || true

# ===== 4. Build and deploy API to Cloud Run =====
echo "🚀 Deploying API to Cloud Run..."
cd backend

gcloud run deploy "$SERVICE_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --source=. \
  --platform=managed \
  --allow-unauthenticated \
  --memory=256Mi \
  --min-instances=0 \
  --max-instances=10 \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=$PROJECT_ID"

API_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format="value(status.url)")

echo ""
echo "✅ API deployed: $API_URL"

cd ..

# ===== 5. Seed initial data =====
echo "🌱 Seeding Firestore with sample data..."
cd backend
GOOGLE_CLOUD_PROJECT="$PROJECT_ID" node scripts/seed-firestore.js
cd ..

# ===== 6. Deploy web catalog (static) =====
echo "🌐 Deploying web catalog..."

# Create a simple Cloud Run service for static files
cat > /tmp/Dockerfile.web << 'WEBDOCKER'
FROM nginx:alpine
COPY web/ /usr/share/nginx/html/
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
WEBDOCKER

# Update API URL in web
sed -i "s|http://localhost:8080|$API_URL|g" web/index.html 2>/dev/null || true

gcloud run deploy "skillbook-web" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --source=. \
  --dockerfile=/tmp/Dockerfile.web \
  --platform=managed \
  --allow-unauthenticated \
  --memory=128Mi \
  --min-instances=0 \
  --max-instances=5

WEB_URL=$(gcloud run services describe "skillbook-web" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format="value(status.url)")

# ===== Summary =====
echo ""
echo "╔══════════════════════════════════════╗"
echo "║  📖 スキルの書 — Deploy Complete!    ║"
echo "╠══════════════════════════════════════╣"
echo "║  API:  $API_URL"
echo "║  Web:  $WEB_URL"
echo "║  Region: $REGION"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Visit $WEB_URL to see the catalog"
echo "  2. npm install -g ./cli && skillbook init"
echo "  3. Share with the team!"
