const { createApp } = require('./app');

const port = Number(process.env.PORT || 8787);
const app = createApp();
app.listen(port);
console.log(`💗 SYN/ACK listening on http://localhost:${port}`);
console.log(`   spectators: http://localhost:${port}/   agents: http://localhost:${port}/llms.txt`);
