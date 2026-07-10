"use client";

import { use } from "react";
import Link from "next/link";
import {
  Avatar,
  Breadcrumb,
  Card,
  Result,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { ArrowLeftOutlined, UserOutlined } from "@ant-design/icons";
import { useHrAccess, useHrEmployee } from "@/features/hr/use-hr";
import { initials, statusColor, statusLabel } from "../../_lib/labels";
import { PersonalTab } from "./_components/personal-tab";
import { JobTab } from "./_components/job-tab";
import { DocumentsTab } from "./_components/documents-tab";

export default function HREmployeeProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { isHrAdmin } = useHrAccess();
  const { data: employee, isLoading, isError, error } = useHrEmployee(id);

  if (isLoading) {
    return (
      <Card>
        <Skeleton active avatar paragraph={{ rows: 4 }} />
      </Card>
    );
  }

  if (isError || !employee) {
    return (
      <Card>
        <Result
          status="404"
          title="Employee not found"
          subTitle={
            error instanceof Error
              ? error.message
              : "This employee may have been removed or you lack access."
          }
          extra={
            <Link href="/hr/employees">
              <Space>
                <ArrowLeftOutlined />
                Back to employees
              </Space>
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <Link href="/hr/dashboard">HR</Link> },
          { title: <Link href="/hr/employees">Employees</Link> },
          { title: employee.full_name },
        ]}
      />

      <Card style={{ marginBottom: 16 }}>
        <Space size="large" align="center">
          <Avatar size={64} icon={<UserOutlined />}>
            {initials(employee.full_name)}
          </Avatar>
          <div>
            <Space align="center">
              <Typography.Title level={4} style={{ margin: 0 }}>
                {employee.full_name}
              </Typography.Title>
              <Tag color={statusColor(employee.status)}>
                {statusLabel(employee.status)}
              </Tag>
              {!employee.user_id ? <Tag>Record only</Tag> : null}
            </Space>
            <div>
              <Typography.Text type="secondary">
                {employee.work_email ?? "No work email"}
              </Typography.Text>
            </div>
          </div>
        </Space>
      </Card>

      <Card>
        <Tabs
          defaultActiveKey="personal"
          items={[
            {
              key: "personal",
              label: "Personal",
              children: <PersonalTab employee={employee} />,
            },
            {
              key: "job",
              label: "Job",
              children: <JobTab employee={employee} canEdit={isHrAdmin} />,
            },
            {
              key: "documents",
              label: "Documents",
              children: (
                <DocumentsTab employeeId={employee.id} canEdit={isHrAdmin} />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
