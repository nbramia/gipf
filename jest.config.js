module.exports = {
  testEnvironment: 'jsdom',
  verbose: false,
  silent: true,
  testMatch: ['**/*.test.js'],
  collectCoverage: false,
  reporters: [
    ['default', {
      showDescriptions: false,
      showColors: true,
      verbose: false,
      maxWorkers: 1,
      errorOnDeprecated: false,
      displayName: false,
      rootDir: process.cwd(),
      testLocationInResults: false,
      testResultsProcessor: (testResults) => {
        // Only return failures and summary
        return {
          numFailedTests: testResults.numFailedTests,
          numPassedTests: testResults.numPassedTests,
          testResults: testResults.testResults.map(result => ({
            failureMessage: result.failureMessage,
            status: result.status,
            name: result.name
          }))
        };
      }
    }]
  ]
}; 