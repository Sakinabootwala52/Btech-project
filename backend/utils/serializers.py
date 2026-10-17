from bson import ObjectId

def serialize_document(document):
    if document is None:
        return None

    result = dict(document)
    if "_id" in result:
        result["_id"] = str(result["_id"])

    return result
