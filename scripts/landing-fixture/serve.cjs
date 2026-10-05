// Run: node scripts/landing-fixture/serve.cjs
// Uses existing project dependencies; no API calls or real credentials.
const webpack = require('webpack');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const output = '/tmp/ramia22-games-browser-bundle';
webpack({
  mode: 'development', devtool: false,
  entry: path.join(__dirname, 'entry.jsx'),
  output: { path: output, filename: 'landing.js' },
  resolve: { extensions: ['.js', '.jsx'], alias: { [path.join(root, 'src/account')]: path.join(__dirname, 'account.js') } },
  module: { rules: [
    { test: /\.jsx?$/, exclude: /node_modules/, use: { loader: require.resolve('babel-loader'), options: { presets: [require.resolve('@babel/preset-react')] } } },
    { test: /\.css$/, use: [require.resolve('style-loader'), require.resolve('css-loader')] },
  ] },
}, (error, stats) => {
  if (error || stats.hasErrors()) { console.error(error || stats.toString()); process.exitCode = 1; return; }
  http.createServer((req, res) => {
    if (req.url === '/landing.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'landing.js'))); }
    else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Games synthetic fixture</title><style>body{margin:0}</style><div id="root"></div><script src="/landing.js"></script></html>'); }
  }).listen(4318, '127.0.0.1', () => console.log('Synthetic landing fixture: http://127.0.0.1:4318/gipf/'));
});
