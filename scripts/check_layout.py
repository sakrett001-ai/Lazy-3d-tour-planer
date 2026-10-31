#!/usr/bin/env python3
"""Conservative 2.5D layout check; see references/checker-format.md."""
import argparse
import json
import math
from pathlib import Path
import sys

EPS = 1e-8


def number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label}: expected finite number")
    return float(value)


def vector(value, length, label):
    if not isinstance(value, list) or len(value) != length:
        raise ValueError(f"{label}: expected array of length {length}")
    return tuple(number(v, label) for v in value)


def array(value, label):
    if not isinstance(value, list):
        raise ValueError(f"{label}: expected array")
    return value


def height(item):
    low, high = vector(item["z"], 2, "z")
    if low >= high:
        raise ValueError("z: bottom must be below top")
    return low, high


def rectangle(center, size, angle):
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    w, d = size[0] / 2, size[1] / 2
    return [(center[0] + x * c - y * s, center[1] + x * s + y * c)
            for x, y in [(-w, -d), (w, -d), (w, d), (-w, d)]]


def edges(poly):
    return zip(poly, poly[1:] + poly[:1])


def overlaps(a, b):
    """SAT: touching surfaces alone do not count as penetration."""
    for poly in (a, b):
        for p, q in edges(poly):
            nx, ny = -(q[1] - p[1]), q[0] - p[0]
            length = math.hypot(nx, ny)
            nx, ny = nx / length, ny / length
            aa = [x * nx + y * ny for x, y in a]
            bb = [x * nx + y * ny for x, y in b]
            if min(max(aa), max(bb)) - max(min(aa), min(bb)) <= EPS:
                return False
    return True


def cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def point_segment(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length2 = dx * dx + dy * dy
    t = 0 if length2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def segment_distance(a, b, c, d):
    x1, x2, y1, y2 = cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)
    if ((x1 > 0 and x2 < 0) or (x1 < 0 and x2 > 0)) and ((y1 > 0 and y2 < 0) or (y1 < 0 and y2 > 0)):
        return 0.0
    return min(point_segment(a, c, d), point_segment(b, c, d), point_segment(c, a, b), point_segment(d, a, b))


def inside(p, poly):
    signs = [cross(a, b, p) for a, b in edges(poly)]
    return all(v >= -EPS for v in signs) or all(v <= EPS for v in signs)


def segment_polygon(a, b, poly):
    if inside(a, poly) or inside(b, poly):
        return 0.0
    return min(segment_distance(a, b, c, d) for c, d in edges(poly))


def polygon_distance(a, b):
    if overlaps(a, b) or inside(a[0], b) or inside(b[0], a):
        return 0.0
    return min(segment_distance(p, q, r, s) for p, q in edges(a) for r, s in edges(b))


def vertical_overlap(a, b):
    return min(a[1], b[1]) - max(a[0], b[0]) > EPS


def outside(poly, bounds):
    return any(x < bounds[0] - EPS or y < bounds[1] - EPS or x > bounds[2] + EPS or y > bounds[3] + EPS for x, y in poly)


def door_polygon(door, relative_angle):
    angle = door["closed_angle_deg"] + relative_angle
    radians = math.radians(angle)
    center = (door["hinge"][0] + door["width"] / 2 * math.cos(radians),
              door["hinge"][1] + door["width"] / 2 * math.sin(radians))
    return rectangle(center, (door["width"], door["thickness"]), angle)


def check_layout(data):
    if not isinstance(data, dict) or data.get("units") != "m":
        raise ValueError('units must be "m"; convert the source explicitly')
    bounds = vector(data["bounds"], 4, "bounds")
    if bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
        raise ValueError("bounds must have positive width and depth")
    ids = set()

    def identifier(item):
        if not isinstance(item, dict):
            raise ValueError("items must be objects")
        ident = item["id"]
        if not isinstance(ident, str) or not ident.strip() or ident in ids:
            raise ValueError("id must be a unique nonempty string")
        ids.add(ident)
        return ident

    objects = {}
    for item in array(data.get("objects", []), "objects"):
        ident = identifier(item)
        center = vector(item["center"], 2, "center")
        size = vector(item["size"], 2, "size")
        if min(size) <= EPS:
            raise ValueError("size values must be positive")
        poly = rectangle(center, size, number(item.get("rotation_deg", 0), "rotation_deg"))
        objects[ident] = {"poly": poly, "z": height(item)}

    doors = {}
    for item in array(data.get("doors", []), "doors"):
        ident = identifier(item)
        door = {"hinge": vector(item["hinge"], 2, "hinge"), "z": height(item)}
        for key in ("width", "thickness", "closed_angle_deg", "open_angle_deg"):
            door[key] = number(item[key], key)
        if min(door["width"], door["thickness"]) <= EPS or abs(door["open_angle_deg"]) > 180:
            raise ValueError("door dimensions must be positive and abs(open_angle_deg) <= 180")
        door["sample_step_deg"] = number(item.get("sample_step_deg", 2), "sample_step_deg")
        if not 0.25 <= door["sample_step_deg"] <= 5:
            raise ValueError("sample_step_deg must be between 0.25 and 5")
        ignored = array(item.get("ignore", []), "ignore")
        if any(not isinstance(i, str) or i not in objects for i in ignored):
            raise ValueError("door ignore must refer to static object ids")
        door["ignore"] = set(ignored)
        doors[ident] = door

    clearances = []
    for item in array(data.get("clearances", []), "clearances"):
        if not isinstance(item, dict):
            raise ValueError("clearances items must be objects")
        a, b = item["a"], item["b"]
        if not isinstance(a, str) or not isinstance(b, str) or a not in objects or b not in objects or a == b:
            raise ValueError("clearance must refer to two different static objects")
        minimum = number(item["min_m"], "min_m")
        if minimum < 0:
            raise ValueError("min_m cannot be negative")
        clearances.append((a, b, minimum))

    routes = []
    for item in array(data.get("routes", []), "routes"):
        ident = identifier(item)
        points = [vector(p, 2, "point") for p in array(item["points"], "points")]
        if len(points) < 2:
            raise ValueError("route must have at least two points")
        radius = number(item["radius_m"], "radius_m")
        if radius <= 0:
            raise ValueError("radius_m must be positive")
        angles = item.get("door_angles_deg", {})
        if not isinstance(angles, dict):
            raise ValueError("door_angles_deg must be an object")
        for key, value in angles.items():
            if key not in doors:
                raise ValueError("route angle refers to an unknown door")
            angle = number(value, "door angle")
            end = doors[key]["open_angle_deg"]
            if not min(0, end) - EPS <= angle <= max(0, end) + EPS:
                raise ValueError("route angle must lie within the door's declared motion")
        routes.append((ident, points, radius, height(item), angles))

    issues, measured = [], []
    static_items = list(objects.items())
    for i, (ident, obj) in enumerate(static_items):
        if outside(obj["poly"], bounds):
            issues.append({"type": "outside_bounds", "object": ident})
        for other_id, other in static_items[i + 1:]:
            if vertical_overlap(obj["z"], other["z"]) and overlaps(obj["poly"], other["poly"]):
                issues.append({"type": "static_overlap", "objects": [ident, other_id]})

    sample_count = 0
    for ident, door in doors.items():
        steps = max(1, math.ceil(abs(door["open_angle_deg"]) / door["sample_step_deg"]))
        found, bounds_hit = set(), False
        for i in range(steps + 1):
            angle = door["open_angle_deg"] * i / steps
            poly = door_polygon(door, angle)
            sample_count += 1
            if not bounds_hit and outside(poly, bounds):
                issues.append({"type": "door_outside_bounds", "door": ident, "angle_deg": round(angle, 4)})
                bounds_hit = True
            for other_id, other in static_items:
                if other_id in found or other_id in door["ignore"]:
                    continue
                if vertical_overlap(door["z"], other["z"]) and overlaps(poly, other["poly"]):
                    issues.append({"type": "door_sweep_overlap", "door": ident, "object": other_id, "angle_deg": round(angle, 4)})
                    found.add(other_id)

    for a, b, minimum in clearances:
        distance = polygon_distance(objects[a]["poly"], objects[b]["poly"])
        result = {"objects": [a, b], "measured_m": round(distance, 5), "required_m": minimum, "ok": distance + EPS >= minimum}
        measured.append(result)
        if not result["ok"]:
            issues.append({"type": "clearance_shortfall", **result})

    for ident, points, radius, z, angles in routes:
        if any(x - radius < bounds[0] - EPS or x + radius > bounds[2] + EPS or y - radius < bounds[1] - EPS or y + radius > bounds[3] + EPS for x, y in points):
            issues.append({"type": "route_outside_bounds", "route": ident})
        obstacles = static_items + [(key, {"poly": door_polygon(door, angles.get(key, 0)), "z": door["z"]}) for key, door in doors.items()]
        for other_id, other in obstacles:
            if not vertical_overlap(z, other["z"]):
                continue
            distance = min(segment_polygon(a, b, other["poly"]) for a, b in zip(points, points[1:]))
            if distance + EPS < radius:
                issues.append({"type": "route_obstructed", "route": ident, "object": other_id, "axis_distance_m": round(distance, 5), "required_radius_m": radius})

    return {
        "status": "issues_detected" if issues else "no_detected_issues",
        "method": "rotated rectangles with vertical intervals; sampled door motion; continuous route segments",
        "coverage": {"objects": len(objects), "doors": len(doors), "door_samples": sample_count, "routes": len(routes), "clearances": len(clearances),
                     "door_ignores": {key: sorted(door["ignore"]) for key, door in doors.items() if door["ignore"]}},
        "unverified": ["exact mesh geometry", "motion between door samples", "simultaneous door-to-door motion", "unmodeled handles and usage volumes", "regulatory compliance", "rendering and FPS"],
        "clearances": measured,
        "issues": issues,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        result = check_layout(json.loads(args.input.read_text(encoding="utf-8")))
        rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if args.output:
            args.output.write_text(rendered, encoding="utf-8")
        else:
            print(rendered, end="")
        return 1 if result["issues"] else 0
    except (OSError, ValueError, KeyError, TypeError, OverflowError) as exc:
        print(f"Invalid layout or file: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
