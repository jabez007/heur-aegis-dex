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
        outDir: 'lib',
        staticImport: true,
        insertTypesEntry: true,
        rollupTypes: true
      }) : null
    ],
    publicDir: isLib ? false : 'public',
    base: isLib ? '/' : '/heur-aegis-dex/',
    build: isLib ? {
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: 'HeurAegisDex',
        fileName: (format) => `heur-aegis-dex.${format}.js`
      },
      rollupOptions: {
        external: ['vue'],
        output: {
          exports: 'named',
          globals: {
            vue: 'Vue'
          }
        }
      },
      outDir: 'lib'
    } : {
      outDir: 'dist'
    }
  }
})
