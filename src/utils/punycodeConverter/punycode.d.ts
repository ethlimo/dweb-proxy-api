declare module "punycode/punycode.js" {
  export function toUnicode(domainString: string): string;
  export function toASCII(domainString: string): string;
}
//this file is only necessary because something in vscode really doesn't like ES6 module names when importing via file
