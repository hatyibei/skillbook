```markdown
# skillbook Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you the core development patterns and conventions used in the `skillbook` JavaScript repository. You'll learn about file naming, import/export styles, commit message conventions, and how to write and run tests. This guide is ideal for contributors looking to maintain consistency and quality in the codebase.

## Coding Conventions

### File Naming
- Use **camelCase** for all file names.
  - Example: `userProfile.js`, `skillBookUtils.js`

### Imports
- Use **relative imports** for all modules.
  - Example:
    ```javascript
    import { getUser } from './userUtils';
    ```

### Exports
- Use **named exports** exclusively.
  - Example:
    ```javascript
    // userUtils.js
    export function getUser(id) { ... }
    export function setUser(user) { ... }
    ```

### Commit Messages
- Follow the **Conventional Commits** format.
- Use the `test` prefix for test-related commits.
- Keep commit messages concise (average ~55 characters).
  - Example:
    ```
    test: add unit tests for getUser function
    ```

## Workflows

### Running Tests
**Trigger:** When you want to verify code correctness.
**Command:** `/run-tests`

1. Identify test files (pattern: `*.test.*`).
2. Run the test suite using your preferred JavaScript test runner.
   - Example (if using Jest):
     ```
     npx jest
     ```
3. Review the output and fix any failing tests.

### Adding a New Module
**Trigger:** When you need to add new functionality.
**Command:** `/add-module`

1. Create a new file using camelCase naming.
2. Write your functions and export them using named exports.
   - Example:
     ```javascript
     // newFeature.js
     export function doSomething() { ... }
     ```
3. Import your module where needed using a relative path.
   - Example:
     ```javascript
     import { doSomething } from './newFeature';
     ```
4. Add corresponding tests in a `newFeature.test.js` file.

### Writing Tests
**Trigger:** When adding or updating code.
**Command:** `/write-tests`

1. Create a test file with the pattern `*.test.js`.
   - Example: `userUtils.test.js`
2. Write test cases covering all exported functions.
   - Example:
     ```javascript
     import { getUser } from './userUtils';

     test('getUser returns correct user', () => {
       expect(getUser(1)).toEqual({ id: 1, name: 'Alice' });
     });
     ```
3. Commit your tests using the `test:` prefix.

## Testing Patterns

- Test files follow the `*.test.*` naming convention (e.g., `module.test.js`).
- The specific test framework is not specified; use your preferred JavaScript testing tool (e.g., Jest, Mocha).
- Each exported function should have corresponding test cases.
- Tests are committed with messages prefixed by `test:`.

## Commands
| Command       | Purpose                                      |
|---------------|----------------------------------------------|
| /run-tests    | Run all test suites in the repository        |
| /add-module   | Add a new module following conventions       |
| /write-tests  | Create and update tests for your code        |
```