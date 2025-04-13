const path = require('path');
const DotenvWebpackPlugin = require('dotenv-webpack');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
    mode: 'production',
    entry: {
        background: './background.js',
        contentScript: './contentScript.js',
        popup: './popup.js',
        chat_script: './chat_script.js'
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
    },
    plugins: [
        new DotenvWebpackPlugin(),
        new CopyPlugin({
            patterns: [
                { from: 'popup.html', to: '' },
                { from: 'popup.css', to: '' },
                { from: 'images', to: 'images' },
                { from: 'key.txt', to: '' },
                { from: 'manifest.dist.json', to: 'manifest.json' },
            ],
        }),
    ],
}; 