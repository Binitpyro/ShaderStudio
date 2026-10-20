// Test-only setup: registers React Testing Library cleanup after each test.
// Opt-in per file: happy-dom test files should set `// @vitest-environment happy-dom`
// as their first line, then `import "../setup/rtl"` (path relative to the test file)
// as their second line. Node-environment tests do not need this file.
// The global vitest environment stays "node"; this file exports nothing.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());
