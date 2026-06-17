import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/lib/reportAdapters/reportRules.test.ts',
      'src/lib/reportAdapters/reportViewModel.test.ts',
      'src/lib/reportAdapters/validateAndRepair.test.ts',
      'src/lib/reportAdapters/detectPropertyCategory.test.ts',
    ],
  },
});
