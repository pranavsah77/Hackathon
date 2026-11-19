import { test, expect } from '@playwright/test';

/**
 * Test Suite 1: Full Qartix Mobility Lifecycle E2E Test
 * Flow:
 * 1. Student Signup -> 
 * 2. Submit Monthly Pass (with Medical Certificate) -> 
 * 3. Admin Reviews & Approves Pass via /admin -> 
 * 4. Scheduled Rides Generated -> 
 * 5. Student Skips a Ride -> 
 * 6. Driver Cockpit Queue Updates in Realtime -> 
 * 7. Driver Marks "I Have Arrived" -> 
 * 8. Student Receives Arrival Notification -> 
 * 9. Logout Cleanly
 */

test.describe('Qartix Full Transit Lifecycle E2E', () => {
  const timestamp = Date.now().toString().slice(-4);
  const testStudentId = `STU-E2E-${timestamp}`;
  const testStudentName = `E2E Student ${timestamp}`;
  const testPassword = 'studentPass123!';
  const testPhone = '9876543210';
  let createdRequestCode = '';

  test('Complete End-to-End Transit Cycle', async ({ page, context }) => {
    // -------------------------------------------------------------------------
    // STEP 1: Student Signup
    // -------------------------------------------------------------------------
    await test.step('1. Student signs up with university credentials', async () => {
      await page.goto('/');

      // Wait for auth screen
      await expect(page.locator('text=STUDENT MOBILITY')).toBeVisible({ timeout: 15000 });

      // Click "Create Account" or switch to Signup mode
      const signupToggle = page.locator('text=New to Qartix? Register here');
      if (await signupToggle.isVisible()) {
        await signupToggle.click();
      }

      // Fill registration form
      await page.fill('input[placeholder*="Full Name"], input[name="fullName"]', testStudentName);
      await page.fill('input[placeholder*="Roll No"], input[placeholder*="email"], input[name="identifier"]', testStudentId);
      await page.fill('input[placeholder*="Mobile"], input[name="phone"]', testPhone);
      await page.fill('input[type="password"]', testPassword);

      // Submit Registration
      await page.click('button:has-text("Create Student Account"), button[type="submit"]');

      // Verify successful signup: user lands on 3D Landing or Dashboard
      await expect(page.locator('text=Get Your Monthly Pass, text=CAMPUS MOBILITY')).toBeVisible({ timeout: 15000 });
    });

    // -------------------------------------------------------------------------
    // STEP 2: Submit Monthly Pass Request
    // -------------------------------------------------------------------------
    await test.step('2. Student configures and submits monthly mobility pass', async () => {
      // Navigate to Pass Builder Dashboard
      const bookPassBtn = page.locator('button:has-text("Get Your Monthly Pass"), button:has-text("Book Pass")');
      if (await bookPassBtn.isVisible()) {
        await bookPassBtn.click();
      }

      await expect(page.locator('text=Pass Builder, text=Monthly Pass Application')).toBeVisible({ timeout: 10000 });

      // Select Route & Schedule
      await page.selectOption('select:has-text("Hostel"), select[name="pickup"]', { index: 0 });
      await page.selectOption('select:has-text("Drop"), select[name="drop"]', { index: 0 });

      // Fill Reason & Medical Condition
      await page.fill('textarea[placeholder*="reason"], textarea[name="reason"]', 'Post-operative recovery with knee crutches, required for daily transit between hostel and lecture core.');

      // Upload valid medical PDF file (using synthetic buffer)
      const buffer = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000053 00000 n\n0000000102 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF');
      
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.click('text=Upload Document, text=Choose File, input[type="file"]');
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles({
        name: 'medical_certificate.pdf',
        mimeType: 'application/pdf',
        buffer,
      });

      // Submit application
      await page.click('button:has-text("Submit for Verification")');

      // Verify UI displays PENDING state and token is hidden
      await expect(page.locator('text=PENDING, text=Pass Application Under Review')).toBeVisible({ timeout: 15000 });
      
      // Capture request code if displayed
      const codeElement = page.locator('text=/REQ-[0-9A-Z]+/').first();
      if (await codeElement.isVisible()) {
        createdRequestCode = (await codeElement.textContent()) || '';
      }
    });

    // -------------------------------------------------------------------------
    // STEP 3: Admin Review & Approval
    // -------------------------------------------------------------------------
    await test.step('3. Admin logs into /admin and approves pass application', async () => {
      // Create new isolated browser page for Admin
      const adminPage = await context.newPage();
      await adminPage.goto('/admin');

      // If not logged in, authenticate as Admin
      if (await adminPage.locator('input[placeholder*="Roll No"], input[placeholder*="email"]').isVisible()) {
        await adminPage.fill('input[placeholder*="Roll No"], input[placeholder*="email"]', 'ADMIN-01');
        await adminPage.fill('input[type="password"]', 'adminPassword123');
        await adminPage.click('button[type="submit"]');
      }

      await expect(adminPage.locator('text=QARTIX TRANSPORT OFFICE, text=Admin Dispatch')).toBeVisible({ timeout: 15000 });

      // Click Pass Requests tab
      await adminPage.click('button:has-text("Pass Requests")');

      // Verify certificate signed URL preview button
      const viewCertBtn = adminPage.locator('button:has-text("View Certificate")').first();
      await expect(viewCertBtn).toBeVisible({ timeout: 10000 });
      await viewCertBtn.click();

      // Ensure modal displays 60s signed URL notice
      await expect(adminPage.locator('text=EXPIRES IN 60 SECONDS')).toBeVisible({ timeout: 5000 });
      await adminPage.click('button:has-text("Close Document Preview")');

      // Click "Approve Pass"
      await adminPage.click('button:has-text("Approve Pass")').first();

      // Fill Review Note
      await adminPage.fill('textarea[placeholder*="remarks"], textarea', 'Verified clinic documentation. Approved for full dispatch windows.');
      await adminPage.click('button:has-text("Confirm Approval")');

      // Verify pass status changes to APPROVED
      await expect(adminPage.locator('text=APPROVED').first()).toBeVisible({ timeout: 10000 });
      await adminPage.close();
    });

    // -------------------------------------------------------------------------
    // STEP 4 & 5: Student Views Active Pass, Generated Rides, and Skips Ride
    // -------------------------------------------------------------------------
    await test.step('4 & 5. Student sees active pass, rides generated, and skips an upcoming ride', async () => {
      await page.reload();

      // Verify pass now shows ACTIVE with QR token rendered
      await expect(page.locator('text=ACTIVE, text=PASS ACTIVE')).toBeVisible({ timeout: 15000 });

      // Check Today's Scheduled Rides
      const skipBtn = page.locator('button:has-text("Skip Today"), button:has-text("Skip Ride")').first();
      await expect(skipBtn).toBeVisible({ timeout: 10000 });

      // Click "Skip Today"
      await skipBtn.click();

      // Confirm skip modal / alert
      const confirmSkipBtn = page.locator('button:has-text("Yes, Skip"), button:has-text("Confirm Skip")');
      if (await confirmSkipBtn.isVisible()) {
        await confirmSkipBtn.click();
      }

      // Verify status transitions to SKIPPED
      await expect(page.locator('text=SKIPPED').first()).toBeVisible({ timeout: 10000 });
    });

    // -------------------------------------------------------------------------
    // STEP 6 & 7: Driver Views Queue and Marks "I Have Arrived"
    // -------------------------------------------------------------------------
    await test.step('6 & 7. Driver cockpit observes updated shift queue and marks arrival', async () => {
      const driverPage = await context.newPage();
      await driverPage.goto('/');

      // Switch to DRIVER tab
      await driverPage.click('button:has-text("DRIVER"), button:has-text("Driver Login")');
      await driverPage.fill('input[placeholder*="Driver ID"], input[placeholder*="Cart Number"]', 'CART-04');
      await driverPage.fill('input[placeholder*="PIN"], input[type="password"]', '4021');
      await driverPage.click('button:has-text("Log In to Cockpit"), button[type="submit"]');

      // Verify Driver Cockpit
      await expect(driverPage.locator('text=DRIVER COCKPIT, text=Shift Queue')).toBeVisible({ timeout: 15000 });

      // Verify Online Toggle is Active
      const onlineToggle = driverPage.locator('text=ONLINE');
      await expect(onlineToggle).toBeVisible();

      // Locate active pickup card and click "I Have Arrived"
      const arrivedBtn = driverPage.locator('button:has-text("I Have Arrived"), button:has-text("Arrived")').first();
      if (await arrivedBtn.isVisible()) {
        await arrivedBtn.click();
        await expect(driverPage.locator('text=ARRIVED, text=Approaching')).toBeVisible({ timeout: 10000 });
      }

      await driverPage.close();
    });

    // -------------------------------------------------------------------------
    // STEP 8 & 9: Student Receives Notification and Logs Out
    // -------------------------------------------------------------------------
    await test.step('8 & 9. Student verifies notification and cleanly logs out', async () => {
      // Check for arrival notification in Student Dashboard
      await expect(page.locator('text=Arrived, text=arrived at station, text=notification')).toBeVisible({ timeout: 15000 });

      // Click Logout
      const logoutBtn = page.locator('button:has-text("Log Out"), button:has-text("Sign Out")').first();
      await expect(logoutBtn).toBeVisible();
      await logoutBtn.click();

      // Verify return to authentication screen
      await expect(page.locator('text=STUDENT MOBILITY, text=Sign In')).toBeVisible({ timeout: 10000 });
    });
  });
});
