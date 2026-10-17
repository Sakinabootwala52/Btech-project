from datetime import datetime

def required_fields(data, fields):
    if not isinstance(data, dict):
        return [*fields]

    return [field for field in fields if field not in data or data[field] in (None, "")]

def parse_timestamp(value):
    if isinstance(value, datetime):
        return value

    if not isinstance(value, str):
        raise ValueError("timestamp must be an ISO-8601 string")

    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)

def validate_coordinates(latitude, longitude):
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        return False

    return -90 <= latitude <= 90 and -180 <= longitude <= 180
