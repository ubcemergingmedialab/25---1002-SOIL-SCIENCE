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
const TABLE = process.env.FIELDS_TABLE_NAME || "eml_fields";

function parsePinsFilterIds(raw) {
  if (raw === undefined || raw === null) return [];
  const trimmed = String(raw).trim();
  if (trimmed === "" || trimmed === "*") return [];
  return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
}

const pinsFilterIds = parsePinsFilterIds(process.env.PINS_FIELD_IDS);

const unwrapAttributeValue = (attr) => {
  if (attr === null || attr === undefined) return undefined;
  if (Array.isArray(attr)) return attr.map(unwrapAttributeValue);
  if (typeof attr !== "object") return attr;
  if ("S" in attr) return attr.S;
  if ("N" in attr) return Number(attr.N);
  if ("BOOL" in attr) return attr.BOOL;
  if ("NULL" in attr) return null;
  if ("L" in attr && Array.isArray(attr.L)) {
    return attr.L.map(unwrapAttributeValue);
  }
  if ("M" in attr && attr.M && typeof attr.M === "object") {
    return Object.fromEntries(
      Object.entries(attr.M).map(([key, value]) => [
        key,
        unwrapAttributeValue(value)
      ])
    );
  }
  return attr;
};

const toNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toStringValue = (value) =>
  typeof value === "string" ? value : undefined;

const parseVector = (raw) => {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const coords = raw.slice(0, 3).map((value) => toNumber(value));
  if (coords.some((val) => typeof val !== "number")) return null;
  return {
    x: coords[0],
    y: coords[1],
    z: coords[2]
  };
};

const parseMarkers = (raw) => {
  const normalized = unwrapAttributeValue(raw);
  if (!Array.isArray(normalized)) return [];

  return normalized
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 4) return null;
      const [iconRaw, scaleRaw, positionRaw] = entry;
      const position = parseVector(positionRaw);
      if (!position) return null;
      const isCurrentShape = entry.length >= 5;
      const savedViewPosition = isCurrentShape ? parseVector(entry[3]) : null;
      const viewPosition = savedViewPosition ?? {
        x: position.x,
        y: position.y + 2.5,
        z: position.z + 5
      };
      const labelRaw = isCurrentShape ? entry[4] : entry[3];
      const label = Array.isArray(labelRaw)
        ? [
            toStringValue(labelRaw[0]) ?? "",
            toStringValue(labelRaw[1]) ?? ""
          ]
        : [toStringValue(labelRaw) ?? "", ""];

      const scale = toNumber(scaleRaw);
      return {
        icon: toStringValue(iconRaw) ?? "",
        scale: scale ?? undefined,
        position,
        viewPosition,
        label,
        text: label[0]
      };
    })
    .filter(Boolean);
};

const parseStartPos = (raw) => {
  const normalized = unwrapAttributeValue(raw);

  if (Array.isArray(normalized) && normalized.length >= 3) {
    const [x, y, z] = normalized.slice(0, 3).map((value) => toNumber(value));
    if ([x, y, z].every((value) => typeof value === "number")) {
      return { x, y, z };
    }
  }

  if (normalized && typeof normalized === "object") {
    const x = toNumber(normalized.x);
    const y = toNumber(normalized.y);
    const z = toNumber(normalized.z);
    if ([x, y, z].every((value) => typeof value === "number")) {
      return { x, y, z };
    }
  }

  return undefined;
};

/** PlayCanvas splat URL + format from DynamoDB (Phase 1 migration). */
function playCanvasAssetFields(item) {
  const fields = {};
  const url = toStringValue(item.FilePlayCanvas);
  const format = toStringValue(item.FileFormat);
  if (url) fields.FilePlayCanvas = url;
  if (format) fields.FileFormat = format;
  return fields;
}

// --- three simple handlers ---

async function getPins() {
  const data = await ddb.send(new ScanCommand({ TableName: TABLE }));
  const filterSet = new Set(pinsFilterIds);
  return (data.Items || [])
    .filter((i) =>
      filterSet.size === 0 ? true : filterSet.has(String(i.FieldID)),
    )
    .map(i => ({
      title: i.Name,
      position: {
        lat: Number(i.Latitude),
        lng: Number(i.Longitude)
      },
      path: i.File,
      ...playCanvasAssetFields(i),
      description: i.Description,
      thumbnail: i.Thumbnail,
      thumbnailAlt: i.ThumbnailAlt,
      start_pos: parseStartPos(i.start_pos),
      start_view_position: parseStartPos(i.start_view_position),
      markers: parseMarkers(i.markers)
    }));
  }
 
async function getFields() {
  const data = await ddb.send(new ScanCommand({ TableName: TABLE }));
  return { items: data.Items || [] };
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
