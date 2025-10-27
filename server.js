const express = require('express');
const proxy = require('http-proxy');
const https = require('https');
const url = require('url');
const path = require('path');

const api = require('./api.js');
const blocked = require('./static/blocked.json');
const reBlocked = require('./static/re_blocked.json');

const port = process.env.PORT || 8080;

// --- CONFIG ---
const subdomainsAsPath = true; // PATH MODE for Render
const serveHomepage = true;
const serveHomepageOnAllSubdomains = false;

// --- CREATE PROXIES ---
const httpsProxy = proxy.createProxyServer({
    agent: new https.Agent({ checkServerIdentity: () => undefined }),
    changeOrigin: true
});

const httpProxy = proxy.createProxyServer({ changeOrigin: true });

// --- ERROR HANDLERS ---
function onProxyError(err, req, res) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Proxying failed.');
}

function onProxyReq(proxyReq, req) {
    proxyReq.setHeader(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36'
    );
    proxyReq.removeHeader('roblox-id');
}

httpsProxy.on('error', onProxyError);
httpsProxy.on('proxyReq', onProxyReq);
httpProxy.on('error', onProxyError);
httpProxy.on('proxyReq', onProxyReq);

// --- EXPRESS SETUP ---
const app = express();

// Serve /proxy static files
app.use('/proxy', express.static('./static'));
app.use('/proxy', api);

// Serve homepage
app.use((req, res, next) => {
    if (serveHomepage && stripSub(req.url)[0] === '/') {
        if (serveHomepageOnAllSubdomains || !getSubdomain(req)) {
            res.sendFile(path.join(__dirname, '/static/home.html'));
            return;
        }
    }
    next();
});

// Blocked URLs
app.use((req, res, next) => {
    if (blocked.includes(req.url)) {
        return res.end('URL blocked.');
    }
    for (let i = 0; i < reBlocked.length; i++) {
        if (req.url.match(reBlocked[i])) return res.end('URL blocked.');
    }
    next();
});

// --- HELPER FUNCTIONS ---
function stripSub(link) {
    let original = url.parse(link);
    let sub = '';
    let pathStr = original.path;
    if (subdomainsAsPath) {
        let split = pathStr.split('/');
        sub = split[1] && split[1] + '.';
        split.splice(1, 1);
        pathStr = split.join('/');
    }
    return [pathStr || '/', sub];
}

function getSubdomain(req, rewrite) {
    let sub;
    if (subdomainsAsPath) {
        let res = stripSub(req.url);
        if (rewrite) req.url = res[0];
        sub = res[1];
    } else {
        let domain = req.headers.host;
        sub = domain.slice(0, domain.lastIndexOf('.', domain.lastIndexOf('.') - 1) + 1);
    }
    return sub;
}

// --- PROXY ROBLOX API REQUESTS ONLY ---
app.use((req, res, next) => {
    // Only proxy paths starting with /friends.roblox.com or /users.roblox.com
    if (req.url.match(/^\/(friends|users)\.roblox\.com/)) {
        const targetUrl = 'https://' + req.url.slice(1); // remove leading '/'
        httpsProxy.web(req, res, { target: targetUrl });
        console.log(`[PROXY] ${req.url} -> ${targetUrl}`);
    } else {
        next(); // ignore favicon, homepage, etc.
    }
});

// Catch-all errors
app.use((err, req, res, next) => {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Proxy handler failed.');
});

// --- START SERVER ---
app.listen(port, () => {
    console.log(`rprxy path-mode proxy running on port ${port}`);
});
