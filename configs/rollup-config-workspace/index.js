import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import swc from '@rollup/plugin-swc'
import externals from 'rollup-plugin-node-externals'

/** @type import('rollup').RollupOptions */
export default {
  input: 'src/action.ts',
  output: {
    dir: 'dist',
    format: 'module',
    name: 'action',
    sourcemap: false,
    esModule: true,
    compact: true,
    minifyInternalExports: true,
    strict: true,
  },
  treeshake: {
    preset: 'recommended',
  },
  plugins: [
    externals({
      builtins: true,
      deps: false,
    }),
    nodeResolve({
      rootDir: 'node_modules',
      preferBuiltins: true,
      exportConditions: ['node'],
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.json', '.node'],
    }),
    json({
      compact: true,
      preferConst: true,
    }),
    commonjs({
      sourceMap: false,
      esmExternals: true,
      strictRequires: true,
      transformMixedEsModules: true,
      ignoreDynamicRequires: false,
      ignoreTryCatch: false,
      extensions: ['.js', '.cjs'],
    }),
    swc({
      swc: {
        isModule: true,
        jsc: {
          parser: {
            syntax: 'typescript',
            dynamicImport: true,
          },
          transform: {
            optimizer: {},
          },
          target: 'es2021',
          loose: false,
          externalHelpers: false,
          keepClassNames: true,
          preserveAllComments: false,
        },
        module: {
          type: 'nodenext',
          strict: true,
          ignoreDynamic: false,
          importInterop: 'node',
        },
        sourceMaps: false,
        minify: false,
      },
    }),
  ],
}
