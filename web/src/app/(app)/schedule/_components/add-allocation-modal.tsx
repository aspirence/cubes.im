"use client";

import { useMemo } from "react";
import {
  Alert,
  App as AntdApp,
  DatePicker,
  Form,
  InputNumber,
  Modal,
  Select,
} from "antd";
import { type Dayjs } from "dayjs";

import { useTeamMembers } from "@/features/team-members/use-team-members";
import { MemberSingleSelect } from "@/features/team-members/member-select";
import { useProjects } from "@/features/projects/use-projects";
import { useCreateAllocation } from "@/features/schedule/use-allocations";
import {
  useTeamAvailability,
  buildAvailabilityIndex,
  formatLeaveDays,
} from "@/features/schedule/use-availability";

interface AllocationFormValues {
  team_member_id: string;
  project_id: string;
  range: [Dayjs, Dayjs];
  hours_per_day: number;
}

export function AddAllocationModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm<AllocationFormValues>();

  const { data: members } = useTeamMembers();
  const { data: projects } = useProjects();
  const createAllocation = useCreateAllocation();

  // Warn (without blocking) when the picked member has approved HR leave
  // inside the picked period.
  const watchedMemberId = Form.useWatch("team_member_id", form);
  const watchedRange = Form.useWatch("range", form);
  const rangeFrom = watchedRange?.[0]?.format("YYYY-MM-DD");
  const rangeTo = watchedRange?.[1]?.format("YYYY-MM-DD");
  const { data: rangeAvailabilityRaw } = useTeamAvailability(
    rangeFrom,
    rangeTo,
  );
  const leaveConflictDays = useMemo(() => {
    if (!watchedMemberId) return [];
    const idx = buildAvailabilityIndex(rangeAvailabilityRaw);
    const days = idx.leaveByMember.get(watchedMemberId);
    return days ? [...days.keys()] : [];
  }, [rangeAvailabilityRaw, watchedMemberId]);

  const memberOptions = (members ?? [])
    .filter((m) => m.user)
    .map((m) => ({
      value: m.id,
      label: m.user?.name ?? m.user?.email ?? "Unknown",
      avatarUrl: m.user?.avatar_url,
      email: m.user?.email,
    }));

  const watchedMemberName =
    memberOptions.find((o) => o.value === watchedMemberId)?.label ??
    "This member";

  const projectOptions = (projects ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }));

  const handleOk = async () => {
    let values: AllocationFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const [from, to] = values.range;
    createAllocation.mutate(
      {
        teamMemberId: values.team_member_id,
        projectId: values.project_id,
        allocatedFrom: from.format("YYYY-MM-DD"),
        allocatedTo: to.format("YYYY-MM-DD"),
        secondsPerDay: Math.round((values.hours_per_day ?? 8) * 3600),
      },
      {
        onSuccess: () => {
          message.success("Allocation added");
          form.resetFields();
          onClose();
        },
        onError: (err) => {
          message.error(
            err instanceof Error ? err.message : "Failed to add allocation",
          );
        },
      },
    );
  };

  return (
    <Modal
      title="Add allocation"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={createAllocation.isPending}
      okText="Add"
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ hours_per_day: 8 }}
        preserve={false}
      >
        <Form.Item
          name="team_member_id"
          label="Team member"
          rules={[{ required: true, message: "Select a team member" }]}
        >
          <MemberSingleSelect options={memberOptions} placeholder="Select member" allowClear={false} />
        </Form.Item>
        <Form.Item
          name="project_id"
          label="Project"
          rules={[{ required: true, message: "Select a project" }]}
        >
          <Select
            options={projectOptions}
            placeholder="Select project"
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>
        <Form.Item
          name="range"
          label="Allocated period"
          rules={[{ required: true, message: "Pick a date range" }]}
        >
          <DatePicker.RangePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="hours_per_day" label="Hours per day">
          <InputNumber min={0} max={24} step={0.5} style={{ width: "100%" }} />
        </Form.Item>
        {leaveConflictDays.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 4 }}
            message={`${watchedMemberName} is on approved leave ${formatLeaveDays(
              leaveConflictDays,
            )} — ${leaveConflictDays.length} working day${
              leaveConflictDays.length === 1 ? "" : "s"
            } of this allocation.`}
          />
        )}
      </Form>
    </Modal>
  );
}
