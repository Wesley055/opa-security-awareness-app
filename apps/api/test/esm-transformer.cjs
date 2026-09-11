// Jest 29's VM cannot require ESM like the supported production Node runtime.
// Transpile module syntax only for the three allowlisted ESM protocol packages.
const ts = require('typescript');
module.exports = {
  process(source, filename) {
    return { code: ts.transpileModule(source, { fileName:filename, compilerOptions:{
      module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,
    }}).outputText };
  },
};
