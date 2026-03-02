module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
  collectCoverageFrom: [
    '**/*.js',
    '!jest.config.js',
    '!node_modules/**',
    '!coverage/**'
  ],
  coverageDirectory: 'coverage',
  testTimeout: 10000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true
};
