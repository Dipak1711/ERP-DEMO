-- 01 · Enums and tiny helpers.
-- Enum labels are deliberately identical to the strings used by the React app
-- ('heatTreatment', 'In Progress', …) so no value mapping is needed.

-- director / plant_head / accounts may see confidential commercial data; every other role sees it masked.
create type app_role        as enum ('director', 'plant_head', 'accounts', 'qc', 'operator', 'viewer');

create type process_stage   as enum ('cutting', 'forging', 'trimming', 'heatTreatment');
create type job_stage       as enum ('cutting', 'forging', 'trimming', 'heatTreatment', 'qc', 'finishedGoods', 'dispatched', 'scrapped');
create type stage_status    as enum ('Pending', 'In Progress', 'Completed');
create type qc_status       as enum ('QC Pending', 'Approved', 'Rejected', 'Partially Approved');
create type dispatch_status as enum ('Ready for Dispatch', 'Dispatched');
create type job_priority    as enum ('Normal', 'High', 'Urgent');
create type hardness_scale  as enum ('HRB', 'HRC', 'HV', 'HB');
create type activity_kind   as enum ('inward', 'job', 'start', 'complete', 'qc', 'fg', 'dispatch', 'reject');

create type die_kind        as enum ('forging', 'trimming');
create type die_status      as enum ('Available', 'In Production', 'Under Maintenance', 'Damaged', 'Retired');
create type metal_type      as enum ('Brass', 'Aluminium', 'Copper', 'Other');
create type main_die_status as enum ('Active', 'Inactive');

create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
