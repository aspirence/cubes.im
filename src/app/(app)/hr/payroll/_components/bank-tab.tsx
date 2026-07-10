"use client";

import { useEffect } from "react";
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Result,
  Space,
  Spin,
  Typography,
} from "antd";
import { BankOutlined } from "@ant-design/icons";
import { useMyEmployee } from "@/features/hr/use-attendance";
import {
  useMyBankDetails,
  useUpsertBankDetails,
} from "@/features/hr/use-payroll";

const { Text, Title } = Typography;

/* -------------------------------------------------------------------------- */
/* Loosely-typed view of the contract row so this tab stays TS-sound           */
/* regardless of the exact shape Agent A's hooks return.                       */
/* -------------------------------------------------------------------------- */

interface BankDetailsLite {
  id?: string;
  account_name: string | null;
  account_number: string | null;
  ifsc: string | null;
  bank_name: string | null;
}

interface BankFormValues {
  account_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string;
}

function friendlyError(err: unknown, fallback: string): string {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/forbidden|permission|policy|not\s*authoriz|row-level/i.test(msg)) {
    return "You do not have permission to perform this action.";
  }
  return msg || fallback;
}

/* ========================================================================== */
/* Bank tab                                                                    */
/* ========================================================================== */

/**
 * Self-service bank details tab. Shows the current user's bank details and a
 * form to create/update them via upsert (keyed by the employee — one row per
 * person). Requires the caller to be linked to an employee record.
 */
export function BankTab() {
  const { message } = App.useApp();
  const { data: myEmployee, isLoading: employeeLoading } = useMyEmployee();
  const { data: bankData, isLoading: bankLoading } = useMyBankDetails();
  const upsert = useUpsertBankDetails();

  const employee = (myEmployee ?? null) as { id?: string } | null;
  const bank = (bankData ?? null) as unknown as BankDetailsLite | null;

  const [form] = Form.useForm<BankFormValues>();

  useEffect(() => {
    form.setFieldsValue({
      account_name: bank?.account_name ?? "",
      account_number: bank?.account_number ?? "",
      ifsc: bank?.ifsc ?? "",
      bank_name: bank?.bank_name ?? "",
    });
  }, [form, bank]);

  const handleSubmit = async () => {
    const values = await form.validateFields();
    try {
      await upsert.mutateAsync({
        accountName: values.account_name.trim(),
        accountNumber: values.account_number.trim(),
        ifsc: values.ifsc.trim(),
        bankName: values.bank_name.trim(),
      } as never);
      message.success("Bank details saved.");
    } catch (err) {
      message.error(friendlyError(err, "Failed to save bank details."));
    }
  };

  if (employeeLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
        <Spin />
      </div>
    );
  }

  if (!employee?.id) {
    return (
      <Result
        status="info"
        title="No employee record"
        subTitle="Your account is not linked to an employee in this organization, so bank details are unavailable. Contact your HR team to get set up."
      />
    );
  }

  return (
    <Card
      style={{ maxWidth: 560 }}
      title={
        <Space>
          <BankOutlined />
          <span>My bank details</span>
        </Space>
      }
    >
      <Title level={5} style={{ marginTop: 0 }}>
        Salary account
      </Title>
      <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
        Used to disburse your salary. Visible only to you and your HR team.
      </Text>

      {bankLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spin />
        </div>
      ) : (
        <Form<BankFormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item
            label="Account holder name"
            name="account_name"
            rules={[
              { required: true, message: "Please enter the account name." },
            ]}
          >
            <Input placeholder="As printed on the account" />
          </Form.Item>
          <Form.Item
            label="Account number"
            name="account_number"
            rules={[
              { required: true, message: "Please enter the account number." },
            ]}
          >
            <Input placeholder="e.g. 123456789012" inputMode="numeric" />
          </Form.Item>
          <Form.Item
            label="IFSC / routing number"
            name="ifsc"
            rules={[
              { required: true, message: "Please enter the IFSC / routing." },
            ]}
            tooltip="IFSC (India) or your bank's routing / sort code."
          >
            <Input placeholder="e.g. HDFC0001234" />
          </Form.Item>
          <Form.Item
            label="Bank name"
            name="bank_name"
            rules={[{ required: true, message: "Please enter the bank name." }]}
          >
            <Input placeholder="e.g. HDFC Bank" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              loading={upsert.isPending}
              onClick={handleSubmit}
            >
              {bank ? "Update bank details" : "Save bank details"}
            </Button>
          </Form.Item>
        </Form>
      )}
    </Card>
  );
}

export default BankTab;
