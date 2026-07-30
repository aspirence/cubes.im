"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useActiveTeam } from "@/features/teams/use-teams";
import type { Database } from "@/types/database";

export type Allocation =
  Database["public"]["Tables"]["project_member_allocations"]["Row"];

/** Embedded project name returned alongside an allocation row. */
export interface AllocationProject {
  id: string;
  name: string;
  team_id: string;
  color_code: string | null;
}

/** Embedded team member -> user profile returned alongside an allocation row. */
export interface AllocationMember {
  id: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
  } | null;
}

/** An allocation row joined to its project and team member -> user profile. */
export type AllocationWithRelations = Allocation & {
  project: AllocationProject | null;
  team_member: AllocationMember | null;
};

const ALLOCATIONS_ROOT = "project-member-allocations" as const;

const teamAllocationsKey = (teamId: string | undefined) =>
  [ALLOCATIONS_ROOT, "team", teamId] as const;

const projectAllocationsKey = (projectId: string | undefined) =>
  [ALLOCATIONS_ROOT, "project", projectId] as const;

/**
 * The FK-embed select string for an allocation joined to its project and the
 * allocated team member's user profile. PostgREST resolves embeds by the named
 * foreign keys; the resulting relational shape is awkward against the generated
 * `Database` type, so callers cast the rows through `unknown`.
 */
const ALLOCATION_SELECT = `
  *,
  project:projects!project_member_allocations_project_id_fk ( id, name, team_id, color_code ),
  team_member:team_members!project_member_allocations_team_member_id_fk (
    id,
    user:users!team_members_user_id_fk ( id, name, email, avatar_url )
  )
`;

/**
 * The same embed, but with the project join forced to an inner join so the
 * result set can be filtered by `projects.team_id` for the active team.
 */
const TEAM_ALLOCATION_SELECT = `
  *,
  project:projects!project_member_allocations_project_id_fk!inner ( id, name, team_id, color_code ),
  team_member:team_members!project_member_allocations_team_member_id_fk (
    id,
    user:users!team_members_user_id_fk ( id, name, email, avatar_url )
  )
`;

/**
 * Lists every allocation for the active team's projects, joined to the project
 * and the allocated team member's user profile. Scoped to `useActiveTeam()` via
 * an inner join on `projects.team_id`.
 */
export function useTeamAllocations() {
  const supabase = useMemo(() => createClient(), []);
  const { data: activeTeam } = useActiveTeam();
  const teamId = activeTeam?.id;

  return useQuery({
    queryKey: teamAllocationsKey(teamId),
    enabled: Boolean(teamId),
    queryFn: async (): Promise<AllocationWithRelations[]> => {
      const { data, error } = await supabase
        .from("project_member_allocations")
        .select(TEAM_ALLOCATION_SELECT)
        .eq("project.team_id", teamId as string)
        .order("allocated_from", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as AllocationWithRelations[];
    },
  });
}

/**
 * Lists the allocations for a single project, joined to the allocated team
 * member's user profile.
 */
export function useProjectAllocations(projectId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: projectAllocationsKey(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<AllocationWithRelations[]> => {
      const { data, error } = await supabase
        .from("project_member_allocations")
        .select(ALLOCATION_SELECT)
        .eq("project_id", projectId as string)
        .order("allocated_from", { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as AllocationWithRelations[];
    },
  });
}

export interface CreateAllocationInput {
  projectId: string;
  teamMemberId: string;
  /** ISO date (yyyy-mm-dd). */
  allocatedFrom: string;
  /** ISO date (yyyy-mm-dd). */
  allocatedTo: string;
  secondsPerDay?: number;
}

/** Creates a project_member_allocations row. */
export function useCreateAllocation() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateAllocationInput): Promise<Allocation> => {
      const { data, error } = await supabase
        .from("project_member_allocations")
        .insert({
          project_id: input.projectId,
          team_member_id: input.teamMemberId,
          allocated_from: input.allocatedFrom,
          allocated_to: input.allocatedTo,
          ...(input.secondsPerDay !== undefined
            ? { seconds_per_day: input.secondsPerDay }
            : {}),
        })
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ALLOCATIONS_ROOT] });
    },
  });
}

export interface UpdateAllocationInput {
  id: string;
  /** ISO date (yyyy-mm-dd). */
  allocatedFrom?: string;
  /** ISO date (yyyy-mm-dd). */
  allocatedTo?: string;
  secondsPerDay?: number;
}

/** Updates a project_member_allocations row's dates / seconds-per-day. */
export function useUpdateAllocation() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateAllocationInput): Promise<Allocation> => {
      const { id, allocatedFrom, allocatedTo, secondsPerDay } = input;
      const { data, error } = await supabase
        .from("project_member_allocations")
        .update({
          ...(allocatedFrom !== undefined
            ? { allocated_from: allocatedFrom }
            : {}),
          ...(allocatedTo !== undefined ? { allocated_to: allocatedTo } : {}),
          ...(secondsPerDay !== undefined
            ? { seconds_per_day: secondsPerDay }
            : {}),
        })
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ALLOCATIONS_ROOT] });
    },
  });
}

/** Deletes a project_member_allocations row. */
export function useDeleteAllocation() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("project_member_allocations")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ALLOCATIONS_ROOT] });
    },
  });
}
