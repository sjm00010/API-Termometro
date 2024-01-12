import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bearerAuth } from "hono/bearer-auth";
import { MongoClient, ServerApiVersion } from "mongodb";
import { config } from "dotenv";

config();

const uri = process.env.MONGO_CS ?? "";
const database = process.env.DB ?? "";
const collection = process.env.COLLECTION ?? "";

if (!uri || !database || !collection)
	throw new Error(
		"Please define the MONGO_CS environment variable inside .env",
	);

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: true,
		deprecationErrors: true,
	},
});

async function save(measure: string): Promise<boolean> {
	let resultado = false;
	try {
		await client.connect();
		await client
			.db(database)
			.collection(collection)
			.insertOne({ value: measure, date: new Date() });
		resultado = true;
	} finally {
		await client.close();
	}
	return resultado;
}

type Measure = {
	value: number;
	date: Date;
};

async function read(dateSearch: Date): Promise<Measure[]> {
	let resultado: Measure[] = [];
	try {
		await client.connect();
		const tempResult = await client
			.db(database)
			.collection(collection)
			.find(
				{ date: { $gte: dateSearch } },
				{ limit: 100, projection: { _id: 0 } },
			)
			.toArray();
		resultado = tempResult as unknown as Measure[];
	} finally {
		await client.close();
	}
	return resultado;
}

async function deleteAll(): Promise<boolean> {
	let resultado = false;
	try {
		await client.connect();
		await client.db(database).collection(collection).deleteMany({});
		resultado = true;
	} finally {
		await client.close();
	}
	return resultado;
}

function secondsToDate(seconds: number): Date {
	const date = new Date();
	date.setSeconds(date.getSeconds() - seconds);
	return date;
}

const app = new Hono();

app.use("*", bearerAuth({ token: process.env.API_KEY ?? "TOKEN" }));
app.use("*", cors());

app.post("/sensor", async (c) => {
	c.status(400);
	try {
		const data = await c.req.json();
		if (data.measure) {
			if (await save(data.measure)) {
				c.status(202);
				return c.json({ message: `Saved: ${data.measure}` });
			}

			c.status(500);
			return c.json({ message: "Failed to saved data" });
		}
		return c.json({ message: "Please send a valid JSON" });
	} catch (e) {
		const error = e as Error;
		return c.json({ message: `Error not expected: ${error.message}` });
	}
});

app.get("/read/:value/:scale", async (c) => {
	c.status(400);
	try {
		const value: number = parseInt(c.req.param("value"));
		const scale = c.req.param("scale");
		if (!value || !scale || value <= 0) {
			c.status(400);
			return c.json({ message: "Please send a valid value and scale" });
		}

		let seconds: number;
		switch (scale) {
			case "hours":
				seconds = value * 3600;
				break;
			case "mins":
				seconds = value * 60;
				break;
			case "secs":
				seconds = value;
				break;
			default: // Minutes
				c.status(400);
				return c.json({ message: "Not implemented" });
		}

		const date = secondsToDate(seconds);
		const measures = await read(date);
		c.status(200);
		return c.json({ measures });
	} catch (e) {
		const error = e as Error;
		return c.json({ message: `Error not expected: ${error.message}` });
	}
});

app.delete("/measures", async (c) => {
	c.status(400);
	try {
		if (await deleteAll()) {
			c.status(200);
			return c.json({ message: "Deleted" });
		}
		c.status(500);
		return c.json({ message: "Failed to delete data" });
	} catch (e) {
		const error = e as Error;
		return c.json({ message: `Error not expected: ${error.message}` });
	}
});

const port = parseInt(process.env.PORT ?? "8080");
console.log(`Server is running on port ${port}`);

serve({
	fetch: app.fetch,
	port,
});
