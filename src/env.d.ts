/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, any>
  export default component
}

declare module 'pokedex-promise-v2';
declare module 'lscache';
declare module 'sha.js';
declare module 'lodash.combinations';
