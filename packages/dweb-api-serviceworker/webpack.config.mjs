import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import HtmlWebpackPlugin from 'html-webpack-plugin'
import HtmlInlineScriptPlugin from 'html-inline-script-webpack-plugin'
import { createRequire } from 'node:module';
import wp from 'webpack';
import NodePolyfillPlugin from 'node-polyfill-webpack-plugin';
const { DefinePlugin } = wp;

const require = createRequire(import.meta.url);


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const createDefaultPlugins = () => {
  return [
    new NodePolyfillPlugin(),
    new DefinePlugin({
      'process.env': {
        'SERVICE_WORKER_TRUSTLESS': JSON.stringify(process.env.SERVICE_WORKER_TRUSTLESS || 'false'),
        'IPFS_TARGET': JSON.stringify(process.env.IPFS_TARGET),
        'NODE_DEBUG': JSON.stringify(false),
        'ETH_RPC_ENDPOINT': JSON.stringify(process.env.ETH_RPC_ENDPOINT),
        'SW_BUNDLE_PUBLIC_URL': process.env.SW_BUNDLE_PUBLIC_URL ? JSON.stringify(process.env.SW_BUNDLE_PUBLIC_URL) : null //should be e.g. http://eth.limo || null
      },
    }),
    ];
}

const resolveRules = {
  extensions: ['.ts', '.js'],
  alias: {
    'lib.js': resolve(__dirname, 'src/lib.ts'),
  }
};
export default [{
  mode: 'development',
  entry: {
    '_limo_loader_main': ['./src/index.ts'],
  },
  output: {
    filename: '[name].js',
    path: resolve(__dirname, 'dist'),
    clean: false,
    module: true,
    libraryTarget: 'self',
    scriptType: 'text/javascript',
  },
  resolve: resolveRules,
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'babel-loader',
        exclude: /node_modules/,
        resolve: {
          fullySpecified: false,
        },
      },
      {
        test: /\.m?js$/,
        resolve: {
          fullySpecified: false,
        },
      }
    ],
  },
  plugins: createDefaultPlugins().concat([
    new HtmlWebpackPlugin()
  ]),
  experiments: {
    outputModule: true,
  },
  devtool: 'source-map',
},
{
  mode: 'development',
  entry: {
    '_limo_loader_sw': './src/service-worker.ts',
  },
  output: {
    filename: '[name].js',
    path: resolve(__dirname, 'dist'),
    clean: false,
    module: true,
    libraryTarget: 'self',
    scriptType: "text/javascript"
  },
  resolve: resolveRules,
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'babel-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.m?js$/,
        resolve: {
          fullySpecified: false,
        },
      }
    ],
  },
  plugins: createDefaultPlugins(),
  experiments: {
    outputModule: true,
  },
  node: {
    global: true,
  },
  devtool: 'source-map',
}];
