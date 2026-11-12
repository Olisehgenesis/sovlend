import { describe, expect, it } from "vitest";

import { reportRowsToCsv } from "./report-csv";

describe("reportRowsToCsv", () => {
  it("converts UGX minor units to whole shillings without adding two zeroes", () => {
    const csv = reportRowsToCsv(
      [{ Currency: "UGX", Principal: "125000000", "Days Overdue": "12", "Interest Rate %": "10.00" }],
      ["Currency", "Principal", "Days Overdue", "Interest Rate %"],
    );

    expect(csv).toContain('"UGX","1250000","12","10.00"');
  });

  it("rounds UGX to zero decimal places and keeps currencies with subunits precise", () => {
    const csv = reportRowsToCsv(
      [
        { Currency: "UGX", Balance: "149" },
        { Currency: "USD", Balance: "12345" },
      ],
      ["Currency", "Balance"],
    );

    expect(csv).toContain('"UGX","1"');
    expect(csv).toContain('"USD","123.45"');
  });

  it("converts PAR bucket outstanding even when the column name contains Days", () => {
    const csv = reportRowsToCsv(
      [
        {
          Currency: "UGX",
          "Total Outstanding": "5890218800",
          "180+ Days Outstanding": "172000000",
          "Days Overdue": "200",
        },
      ],
      ["Currency", "Total Outstanding", "180+ Days Outstanding", "Days Overdue"],
    );

    expect(csv).toContain('"UGX","58902188","1720000","200"');
  });

  it("does not convert non-money columns or non-numeric report cells", () => {
    const csv = reportRowsToCsv(
      [{ Currency: "UGX", "Loan Account No.": "001234", "Aging Bucket": "1-30 days", Balance: "" }],
      ["Currency", "Loan Account No.", "Aging Bucket", "Balance"],
    );

    expect(csv).toContain('"UGX","001234","1-30 days",""');
  });

  it("converts Collections Others from minor units so CSV matches the on-screen figure", () => {
    // Audit #1: screen showed 1,137,703,069 while CSV left Others as 113,770,306,949 (100×).
    const csv = reportRowsToCsv(
      [{ Currency: "UGX", Others: "113770306949", "Total Receipt Amount": "115498135700" }],
      ["Currency", "Others", "Total Receipt Amount"],
    );

    expect(csv).toContain('"UGX","1137703069","1154981357"');
  });
});

