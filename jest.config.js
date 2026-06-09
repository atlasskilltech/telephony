module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/migrations/**',
    '!src/seeders/**',
    '!src/queues/worker.js',
  ],
  coverageThreshold: {
    // Aspirational target; unit suites here cover the pure logic. Raise as
    // integration coverage grows.
    global: { branches: 0, functions: 0, lines: 0, statements: 0 },
  },
  testTimeout: 20000,
  moduleNameMapper: {
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
  },
};
