import json
import base64
import kociemba

def _parse_event(event):
    # function URL sends { body: "~~~", isBase64Encoded: bool, ~~~ }
    if "body" in event:
        raw_body = event["body"]
        if event.get("isBase64Encoded"):
            raw_body = base64.b64decode(raw_body)
        if isinstance(raw_body, (bytes, bytearray)):
            raw_body = raw_body.decode("utf-8")
        try:
            data = json.loads(raw_body)
        except json.JSONDecodeError:
            data = {}
    else:
        # direct invoke, local test path
        data = event
    return data

def lambda_handler(event, context):
    data = _parse_event(event)

    cube_str = data.get("cube")
    if not isinstance(cube_str, str):
        return {
            "statusCode": 400,
            "headers": {
                "content-type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            "body": json.dumps({"error": "missing or invalid 'cube' string"})
        }

    try:
        solution = kociemba.solve(cube_str)
    except Exception as e:
        # invalid cube string, so not solvable
        return {
            "statusCode": 400,
            "headers": {
                "content-type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            "body": json.dumps({"error": str(e)})
        }

    return {
        "statusCode": 200,
        "headers": {
            "content-type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        "body": json.dumps({
            "solution": solution
        })
    }

# local debugging
if __name__ == "__main__":
    test_event = {
        "cube": "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"
    }
    print(lambda_handler(test_event, None))
