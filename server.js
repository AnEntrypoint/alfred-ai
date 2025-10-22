import express from 'express';
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Express Server</title>
        <style>
            body { 
                font-family: Arial, sans-serif; 
                display: flex; 
                justify-content: center; 
                align-items: center; 
                height: 100vh; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                margin: 0;
            }
            .container { 
                text-align: center; 
                background: white; 
                padding: 2rem; 
                border-radius: 10px; 
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            }
            h1 { color: #333; }
            p { color: #666; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Express Server is Running!</h1>
            <p>Server successfully started on port 3000</p>
            <p>Timestamp: ${new Date().toLocaleString()}</p>
        </div>
    </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});