import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
 // Archived source copies and Playwright suites are not unit-test inputs.
 test:{include:['tests/**/*.test.ts','tests/**/*.test.mjs'],exclude:['tests/rules-v4.test.ts','tests/rules-presentation.test.ts']},
});
