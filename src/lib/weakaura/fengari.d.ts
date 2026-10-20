declare module 'fengari-web' {
  interface FengariWeb {
    lua: {
      LUA_OK: number;
      lua_getglobal(L: unknown, name: Uint8Array): number;
      lua_tolstring(L: unknown, index: number): Uint8Array;
      lua_toboolean(L: unknown, index: number): boolean;
    };
    lauxlib: {
      luaL_newstate(): unknown;
      luaL_dostring(L: unknown, code: Uint8Array): number;
    };
    lualib: {
      luaL_openlibs(L: unknown): void;
    };
    to_luastring(value: string): Uint8Array;
    to_jsstring(value: Uint8Array): string;
  }
  const fengariWeb: FengariWeb;
  export default fengariWeb;
  export const lua: FengariWeb['lua'];
  export const lauxlib: FengariWeb['lauxlib'];
  export const lualib: FengariWeb['lualib'];
  export function to_luastring(value: string): Uint8Array;
  export function to_jsstring(value: Uint8Array): string;
}
