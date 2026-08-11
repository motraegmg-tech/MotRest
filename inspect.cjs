const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.LOCALAPPDATA + '/MotRest/datos/hub.sqlite');
console.log(db.prepare("SELECT * FROM dispositivos").all());
