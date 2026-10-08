// Tests read JSON bodies without declaring their shape, which the DOM lib's
// `Response.json()` allows and Node's, returning `unknown`, does not.
declare global {
  interface Response {
    json(): Promise<any>;
  }
}

export {};
