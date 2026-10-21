import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // The suite runs ~83 files in parallel workers, each creating a fresh jsdom
    // (~300s of environment time across a full run). Tests that additionally
    // await a dynamic import (the on-demand dialogs/tabs this batch introduced)
    // routinely take 1-2s alone and cross the 5s default once the machine is
    // saturated — they then fail with a timeout that says nothing about the
    // code under test. 15s keeps a real hang visible while removing that noise.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
  resolve: {
    conditions: ['development'],
  },
})
