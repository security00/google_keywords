import { beforeEach, describe, expect, test, vi } from "vitest";

const mockRequireAdmin = vi.hoisted(() => vi.fn());
const mockActivateUserTrials = vi.hoisted(() => vi.fn());
const mockListActivatedStudents = vi.hoisted(() => vi.fn());
const mockSendAccountActivatedEmail = vi.hoisted(() => vi.fn());
const mockRequireCronOrAdmin = vi.hoisted(() => vi.fn());
const mockIsAuthzError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/admin", () => ({
  requireAdmin: mockRequireAdmin,
  activateUserTrials: mockActivateUserTrials,
  listActivatedStudents: mockListActivatedStudents,
  listUsers: vi.fn(),
  listPendingUsers: vi.fn(),
  listActiveUsers: vi.fn(),
}));

vi.mock("@/lib/authz", () => ({
  requireCronOrAdmin: mockRequireCronOrAdmin,
  isAuthzError: mockIsAuthzError,
}));

vi.mock("@/lib/admin_health", () => ({
  listRecentPrecomputeHealth: vi.fn(),
  writePrecomputeHealth: vi.fn(),
}));

vi.mock("@/lib/lifecycle-emails", () => ({
  sendAccountActivatedEmail: mockSendAccountActivatedEmail,
}));

const { POST } = await import("./route");

const postActivate = (body: Record<string, unknown>) =>
  POST(
    new Request("https://discoverkeywords.co/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

describe("POST /api/admin/users activate_trial", () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset();
    mockActivateUserTrials.mockReset();
    mockListActivatedStudents.mockReset();
    mockSendAccountActivatedEmail.mockReset();
    mockRequireCronOrAdmin.mockReset();
    mockIsAuthzError.mockReset();
    mockRequireAdmin.mockResolvedValue({ userId: "admin-1" });
    mockIsAuthzError.mockReturnValue(false);
  });

  test("awaits activation emails before responding", async () => {
    let sendFinished = false;
    mockActivateUserTrials.mockResolvedValueOnce({
      updated: 1,
      users: [{ id: "user-1", email: "student@example.com" }],
    });
    mockSendAccountActivatedEmail.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      sendFinished = true;
      return "sent";
    });

    const response = await postActivate({
      action: "activate_trial",
      userIds: ["user-1"],
      trialDays: 90,
    });

    expect(sendFinished).toBe(true);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      updated: 1,
      emailed: 1,
    });
    expect(mockSendAccountActivatedEmail).toHaveBeenCalledWith("user-1", "student@example.com");
  });

  test("still opens the trial when Inbox send fails", async () => {
    mockActivateUserTrials.mockResolvedValueOnce({
      updated: 1,
      users: [{ id: "user-1", email: "student@example.com" }],
    });
    mockSendAccountActivatedEmail.mockRejectedValueOnce(new Error("INBOX binding is missing"));

    const response = await postActivate({
      action: "activate_trial",
      userIds: ["user-1"],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      updated: 1,
      emailed: 0,
    });
  });

  test("resends activation mail without changing the trial window", async () => {
    mockRequireCronOrAdmin.mockResolvedValueOnce({
      userId: "admin-1",
      role: "admin",
      authMethod: "cron",
      scopes: [],
    });
    mockListActivatedStudents.mockResolvedValueOnce([
      { id: "user-1", email: "student@example.com" },
    ]);
    mockSendAccountActivatedEmail.mockResolvedValueOnce("sent");

    const response = await postActivate({
      action: "resend_activation_email",
      emails: ["student@example.com"],
    });

    expect(response.status).toBe(200);
    expect(mockActivateUserTrials).not.toHaveBeenCalled();
    expect(mockListActivatedStudents).toHaveBeenCalledWith({
      userIds: [],
      emails: ["student@example.com"],
    });
    await expect(response.json()).resolves.toMatchObject({
      matched: 1,
      emailed: 1,
    });
  });
});
