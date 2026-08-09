drop extension if exists "pg_net";

revoke references on table "public"."admin_auth_rate_limits" from "anon";

revoke trigger on table "public"."admin_auth_rate_limits" from "anon";

revoke truncate on table "public"."admin_auth_rate_limits" from "anon";

revoke references on table "public"."admin_auth_rate_limits" from "authenticated";

revoke trigger on table "public"."admin_auth_rate_limits" from "authenticated";

revoke truncate on table "public"."admin_auth_rate_limits" from "authenticated";

revoke references on table "public"."admin_sessions" from "anon";

revoke trigger on table "public"."admin_sessions" from "anon";

revoke truncate on table "public"."admin_sessions" from "anon";

revoke references on table "public"."admin_sessions" from "authenticated";

revoke trigger on table "public"."admin_sessions" from "authenticated";

revoke truncate on table "public"."admin_sessions" from "authenticated";

revoke references on table "public"."organization_admin_sessions" from "anon";

revoke trigger on table "public"."organization_admin_sessions" from "anon";

revoke truncate on table "public"."organization_admin_sessions" from "anon";

revoke references on table "public"."organization_admin_sessions" from "authenticated";

revoke trigger on table "public"."organization_admin_sessions" from "authenticated";

revoke truncate on table "public"."organization_admin_sessions" from "authenticated";

revoke references on table "public"."organization_admins" from "anon";

revoke trigger on table "public"."organization_admins" from "anon";

revoke truncate on table "public"."organization_admins" from "anon";

revoke references on table "public"."organization_admins" from "authenticated";

revoke trigger on table "public"."organization_admins" from "authenticated";

revoke truncate on table "public"."organization_admins" from "authenticated";


