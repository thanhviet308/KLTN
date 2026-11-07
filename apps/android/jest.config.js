module.exports = {
  preset: '@react-native/jest-preset',
  cacheDirectory: '<rootDir>/build/jest',
  // Match Metro: all libraries must use Android's pinned React instance.
  moduleNameMapper: {
    '^react$': require.resolve('react'),
    '^react/(.*)$': '<rootDir>/node_modules/react/$1',
  },
};
