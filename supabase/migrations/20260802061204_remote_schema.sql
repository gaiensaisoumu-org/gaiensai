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

CREATE INDEX class_performances_image_path_idx ON public.class_performances USING btree (image_path);


