declare module 'fengari-web' {
  const fengariWeb: {
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
  };
  export default fengariWeb;
}
