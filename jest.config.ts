import type { JestConfigWithTsJest } from 'ts-jest'

const jestConfig: JestConfigWithTsJest = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        isolatedModules: true,
        tsconfig: {
          rootDir: ".",
          moduleResolution: "NodeNext",
          module: "NodeNext"
        }
      },
    ],
  },
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "json-summary", "lcov", "clover"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/index.ts",
    "!src/interfaces/**",
    "!src/config/types.ts",
    "!src/middleware/types.ts"
  ]
}

export default jestConfig
