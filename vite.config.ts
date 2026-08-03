import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import dts from 'vite-plugin-dts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isLib = mode === 'lib'

  return {
    plugins: [
      vue(),
      isLib ? dts({
        include: ['src/**/*.ts', 'src/**/*.vue'],
        // Test files and their fixtures live inside src, so without this the
        // published package ships a .d.ts stub for each of them.
        exclude: [
          'src/**/*.test.ts',
          'src/**/*.spec.ts',
          'src/**/*.fixture.ts',
          'src/lib/pokedexLive.ts'
        ],
        outDirs: [
          'lib',
          { dir: 'lib', moduleFormat: 'esm' },
          { dir: 'lib', moduleFormat: 'cjs' }
        ],
        staticImport: true,
        insertTypesEntry: true,
        bundleTypes: true
      }) : null
    ],
    publicDir: isLib ? false : 'public',
    base: isLib ? '/' : '/heur-aegis-dex/',
    build: isLib ? {
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: 'HeurAegisDex'
      },
      rollupOptions: {
        external: ['vue'],
        output: [
          {
            format: 'es',
            entryFileNames: 'heur-aegis-dex.es.js',
            chunkFileNames: '[name]-[hash].js',
            globals: {
              vue: 'Vue'
            }
          },
          {
            format: 'cjs',
            entryFileNames: 'heur-aegis-dex.cjs',
            chunkFileNames: '[name]-[hash].cjs',
            exports: 'named',
            globals: {
              vue: 'Vue'
            }
          }
        ]
      },
      outDir: 'lib'
    } : {
      outDir: 'dist'
    }
  }
})
