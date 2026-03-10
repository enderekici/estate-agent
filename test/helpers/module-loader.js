const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function loadModule(modulePath, options = {}) {
  const absolutePath = path.resolve(modulePath);
  const stubs = options.stubs || {};
  const transform = options.transform || ((source) => source);

  const source = fs.readFileSync(absolutePath, 'utf8');
  const transformedSource = transform(source, absolutePath);

  const mod = new Module(absolutePath, module.parent);
  mod.filename = absolutePath;
  mod.paths = Module._nodeModulePaths(path.dirname(absolutePath));

  const originalRequire = mod.require.bind(mod);
  mod.require = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }

    let resolved;
    try {
      resolved = Module._resolveFilename(request, mod);
    } catch (_) {
      return originalRequire(request);
    }

    if (Object.prototype.hasOwnProperty.call(stubs, resolved)) {
      return stubs[resolved];
    }

    return originalRequire(request);
  };

  mod._compile(transformedSource, absolutePath);
  return mod.exports;
}

module.exports = { loadModule };
