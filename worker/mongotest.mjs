import { MongoClient } from "mongodb";
const uri = process.argv[2];
const name = process.argv[3];
try {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
  await c.connect();
  await c.db("admin").command({ ping: 1 });
  console.log(name, "OK", (await c.db("admin").command({ buildInfo: 1 })).version);
  await c.close();
} catch (e) {
  console.log(name, "FAIL", e.name + ":", e.message.slice(0, 300));
}
