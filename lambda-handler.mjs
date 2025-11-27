import {
  DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand
} from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({region: "ca-central-1"})
);
const TABLE = "eml_fields";

// --- three simple handlers ---

async function getPins() {
  const data = await ddb.send(new ScanCommand({ TableName: TABLE }));
  return (data.Items || [])
    .filter(i => ["TestA", "TestB", "TestC"].includes(String(i.FieldID)))
    .map(i => ({
      title: i.Name,
      position: { lat: Number(i.Latitude), lng: Number(i.Longitude) },
      path: i.File,
      description: i.Description,
      thumbnail: i.Thumbnail,
      thumbnailAlt: i.ThumbnailAlt
    }));
}

async function getFields() {
  const data = await ddb.send(new ScanCommand({ TableName: TABLE }));
  return data.Items || [];
}

async function getFieldById(id) {
  const res = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { FieldID: id }
  }));
  return res.Item || null;
}

// --- main Lambda entry point ---

export const handler = async (event) => {
  const path = event.rawPath || event.path;
  const method = event.requestContext?.http?.method || event.httpMethod;

  try {
    if (method === "GET" && path === "/pins")
      return json(200, await getPins());

    if (method === "GET" && path === "/fields")
      return json(200, await getFields());

    const match = path.match(/^\/fields\/([^/]+)$/);
    if (method === "GET" && match) {
      const item = await getFieldById(match[1]);
      return item ? json(200, item) : json(404, { error: "Not found" });
    }

    return json(404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    return json(500, { error: "Server error" });
  }
};

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify(body)
});

