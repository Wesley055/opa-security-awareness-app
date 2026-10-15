'use strict';
const {prepare}=require('./production/prepare-runtime.cjs');
if(require.main===module){try{console.log(JSON.stringify(prepare(...process.argv.slice(2))))}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'DURABLE_RUNTIME_PREPARATION_REJECTED');process.exitCode=1}}
module.exports={prepare};
