import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { exec } from 'child_process';
import { createEmailMessage } from '../node_modules/@gongrzhe/server-gmail-autoauth-mcp/dist/utl.js';

const CONFIG_DIR = path.join(os.homedir(), '.gmail-mcp');
const OAUTH_PATH = path.join(CONFIG_DIR, 'gcp-oauth.keys.json');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');

async function main() {
  if (!fs.existsSync(OAUTH_PATH)) {
    console.error('OAuth keys missing:', OAUTH_PATH);
    process.exit(1);
  }

  const keysContent = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
  const keys = keysContent.installed || keysContent.web;

  const callback = "http://localhost:3000/oauth2callback";
  const oauth2Client = new google.auth.OAuth2(keys.client_id, keys.client_secret, callback);

  console.log("Starting local auth server on http://localhost:3000...");

  const server = http.createServer();
  server.listen(3000);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force refresh token generation
    scope: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.settings.basic'
    ],
  });

  console.log('\n==================================================');
  console.log('PLEASE OPEN THIS URL IN YOUR BROWSER TO AUTHENTICATE:');
  console.log(authUrl);
  console.log('==================================================\n');

  // Attempt to open in default browser on Windows
  exec(`start "" "${authUrl}"`);

  return new Promise((resolve, reject) => {
    server.on('request', async (req, res) => {
      if (!req.url?.startsWith('/oauth2callback')) return;
      const url = new URL(req.url, 'http://localhost:3000');
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('No code provided');
        reject(new Error('No code provided'));
        return;
      }
      try {
        console.log('Received auth code! Exchanging for tokens...');
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Save fresh credentials
        fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(tokens, null, 2));
        console.log('Successfully saved fresh credentials to', CREDENTIALS_PATH);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Authentication Successful!</h2><p>Sending your email now... You can close this window.</p>');
        server.close();

        // Send email
        console.log('Sending email to bharathidevi2404@gmail.com...');
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        const rawMessage = createEmailMessage({
          to: ['bharathidevi2404@gmail.com'],
          subject: 'Movie tomorrow',
          body: 'Hi Akka,\n\nWe need to go to a movie tomorrow!\n\nBest,',
          mimeType: 'text/plain'
        });

        const encodedMessage = Buffer.from(rawMessage)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const response = await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: encodedMessage
          }
        });

        console.log('SUCCESS: Email sent! Message ID:', response.data.id);
        resolve(response.data);
      } catch (err) {
        console.error('Error during token exchange or email sending:', err);
        res.writeHead(500);
        res.end('Error: ' + err.message);
        reject(err);
      }
    });
  });
}

main().catch(console.error);
