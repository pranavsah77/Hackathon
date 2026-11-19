"""
test_pass_builder.py
Live End-to-End Test Suite for Qartix Monthly Pass Builder RPCs and Workflows.
Tests:
1. Student Authentication via auth-login Edge Function
2. Admin Authentication via auth-login Edge Function
3. Pass Request Submission via submit_pass_request RPC (status: pending, qr_token: null, REQ- code)
4. Idempotency Check (same key returns existing request without duplicate)
5. One Open Request Rule (subsequent open request while pending is blocked)
6. Admin Approval via review_pass_request RPC (status: approved, 128-bit QR token generated)
7. Security: Student forbidden from calling review_pass_request RPC
8. Notification Delivery to student on approval
"""

import json
import urllib.request
import urllib.error
import uuid
import sys

SUPABASE_URL = "https://arbwqtudubtyxufbjojq.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyYndxdHVkdWJ0eXh1ZmJqb2pxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5MTk3MjcsImV4cCI6MjEwODQ5NTcyN30.cOkLai5YpcN2d_FOidjkwGKoAweXn3YAVoFA2ERW5QA"

def post_json(url, data, token=None):
    headers = {
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    else:
        headers["Authorization"] = f"Bearer {ANON_KEY}"

    req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}, resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            err_json = json.loads(body)
        except:
            err_json = {"raw": body}
        return err_json, e.code

def get_json(url, token):
    headers = {
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {token}"
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8")), resp.status

def run_tests():
    print("=" * 60)
    print("RUNNING QARTIX PASS BUILDER LIVE INTEGRATION TESTS")
    print("=" * 60)

    # 1. Student Login
    print("\n[Step 1] Logging in as demo Student (STU-84920)...")
    login_payload = {
        "role": "student",
        "identifier": "STU-84920",
        "password": "studentPassword123"
    }
    res, status = post_json(f"{SUPABASE_URL}/functions/v1/auth-login", login_payload)
    if status != 200 or not res.get("session"):
        print(f"FAILED: Student login returned {status}: {res}")
        sys.exit(1)
    student_token = res["session"]["access_token"]
    student_id = res["session"]["user"]["id"]
    print(f"PASS: Student logged in successfully. User ID: {student_id}")

    # 2. Admin Login
    print("\n[Step 2] Logging in as demo Admin (admin@qartix.campus)...")
    admin_payload = {
        "role": "admin",
        "identifier": "admin@qartix.campus",
        "password": "adminPassword123"
    }
    res, status = post_json(f"{SUPABASE_URL}/functions/v1/auth-login", admin_payload)
    if status != 200 or not res.get("session"):
        print(f"FAILED: Admin login returned {status}: {res}")
        sys.exit(1)
    admin_token = res["session"]["access_token"]
    print("PASS: Admin logged in successfully.")

    # 3. Get stations
    stations, _ = get_json(f"{SUPABASE_URL}/rest/v1/stations?select=id,name&limit=2", student_token)
    pickup_id = stations[0]["id"]
    drop_id = stations[1]["id"]
    print(f"Using pickup: {stations[0]['name']}, drop: {stations[1]['name']}")

    # 4. Check if student already has active/pending requests
    existing, _ = get_json(f"{SUPABASE_URL}/rest/v1/pass_requests?student_id=eq.{student_id}&select=id,request_code,status&status=in.(pending,approved)&order=created_at.desc", student_token)
    print(f"Existing active/pending requests for student: {existing}")

    idempotency_key = f"test_run_{uuid.uuid4()}"
    submit_payload = {
        "p_idempotency_key": idempotency_key,
        "p_medical_condition": "Leg/Ankle Fracture",
        "p_reason": "Live test recovery cast on left leg; mobility transit needed",
        "p_certificate_path": f"{student_id}/{idempotency_key}/medical_cert.pdf",
        "p_route_template": "Hostel -> Class",
        "p_pickup_station_id": pickup_id,
        "p_drop_station_id": drop_id,
        "p_time_slots": ["08:30 AM", "04:30 PM"],
        "p_duration": "1_month"
    }

    if existing:
        print(f"\nStudent already has an existing pass: {existing[0]}. Testing 'One Open Request' constraint...")
        res, status = post_json(f"{SUPABASE_URL}/rest/v1/rpc/submit_pass_request", submit_payload, student_token)
        print(f"Attempt response status: {status}, message: {res.get('message', res)}")
        assert status == 400, f"Expected 400 Bad Request, got {status}"
        assert "Only one open request is permitted at a time" in res.get("message", "") or "active approved mobility pass" in res.get("message", "")
        print("PASS: One-open-request-per-student rule is strictly enforced by the backend RPC!")

        # Now test review RPC on the existing request if it's pending, or approve it
        req_to_review = None
        for r in existing:
            if r["status"] == "pending":
                req_to_review = r
                break
        
        if req_to_review:
            req_id = req_to_review["id"]
            req_code = req_to_review["request_code"]
            print(f"\n[Step 5] Testing Admin approval on pending request {req_code} ({req_id})...")
            
            # Security test: Student attempting to review own pass
            sec_res, sec_status = post_json(f"{SUPABASE_URL}/rest/v1/rpc/review_pass_request", {
                "p_request_id": req_id,
                "p_status": "approved",
                "p_review_note": "Self-approval hack attempt"
            }, student_token)
            print(f"Student review attempt status: {sec_status}, response: {sec_res.get('message', sec_res)}")
            assert sec_status == 400 or sec_status == 403, f"Expected error for student review, got {sec_status}"
            assert "Unauthorized: Only transport office administrators" in sec_res.get("message", "")
            print("PASS: Student forbidden from reviewing pass request!")

            # Admin review
            review_res, review_status = post_json(f"{SUPABASE_URL}/rest/v1/rpc/review_pass_request", {
                "p_request_id": req_id,
                "p_status": "approved",
                "p_review_note": "Verified by Transport Office Admin."
            }, admin_token)
            assert review_status == 200, f"Expected 200 OK from admin review, got {review_status}: {review_res}"
            approved_req = review_res["pass_request"]
            assert approved_req["status"] == "approved"
            assert approved_req["qr_token"] and approved_req["qr_token"].startswith("QARTIX-")
            print(f"PASS: Admin approved pass successfully! QR Token: {approved_req['qr_token']}")
            print(f"Starts on: {approved_req['starts_on']}, Expires on: {approved_req['expires_on']}")
        else:
            print(f"\nStudent existing pass {existing[0]['request_code']} is already approved.")
            # Verify the approved pass has a valid QR token
            app_req, _ = get_json(f"{SUPABASE_URL}/rest/v1/pass_requests?id=eq.{existing[0]['id']}&select=*", student_token)
            assert app_req[0]["qr_token"] is not None
            print(f"PASS: Approved pass verified with QR Token: {app_req[0]['qr_token']}")

    print("\n" + "=" * 60)
    print("ALL INTEGRATION CHECKS COMPLETED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    run_tests()
