-- Migration: 20261120090005_qartix_ride_security_refinements.sql
-- Description: Fix search_path on trigger & parser functions and lock down cron procedures.

CREATE OR REPLACE FUNCTION public.check_ride_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'completed' AND (
    NEW.status <> 'completed' OR 
    NEW.scheduled_for <> OLD.scheduled_for OR 
    NEW.pickup_station_id <> OLD.pickup_station_id OR 
    NEW.drop_station_id <> OLD.drop_station_id
  ) THEN
    RAISE EXCEPTION 'Completed rides cannot be modified.';
  END IF;

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot change status of a ride that is already %.', OLD.status;
  END IF;

  CASE OLD.status
    WHEN 'requested' THEN
      IF NEW.status NOT IN ('scheduled', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid ride status transition from requested to %. Must be scheduled or cancelled.', NEW.status;
      END IF;
    WHEN 'scheduled' THEN
      IF NEW.status NOT IN ('approaching', 'skipped', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid ride status transition from scheduled to %. Cannot skip approaching state.', NEW.status;
      END IF;
    WHEN 'approaching' THEN
      IF NEW.status NOT IN ('arrived', 'skipped', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid ride status transition from approaching to %. Must transition to arrived.', NEW.status;
      END IF;
    WHEN 'arrived' THEN
      IF NEW.status NOT IN ('in_progress', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid ride status transition from arrived to %. Must transition to in_progress.', NEW.status;
      END IF;
    WHEN 'in_progress' THEN
      IF NEW.status NOT IN ('completed', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid ride status transition from in_progress to %. Must transition to completed.', NEW.status;
      END IF;
    WHEN 'skipped' THEN
      IF NEW.status <> 'scheduled' THEN
        RAISE EXCEPTION 'A skipped ride cannot transition directly to %.', NEW.status;
      END IF;
    ELSE
      NULL;
  END CASE;

  IF NEW.status = 'arrived' AND NEW.arrived_at IS NULL THEN
    NEW.arrived_at := now();
  ELSIF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := now();
  ELSIF NEW.status = 'skipped' AND NEW.skipped_at IS NULL THEN
    NEW.skipped_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.parse_time_slot(p_slot text)
RETURNS time
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clean text;
BEGIN
  v_clean := trim(p_slot);
  IF v_clean ~* '^[0-1]?[0-9]:[0-5][0-9]\s*(AM|PM)$' THEN
    RETURN to_timestamp(v_clean, 'HH12:MI AM')::time;
  ELSIF v_clean ~* '^[0-2]?[0-9]:[0-5][0-9]$' THEN
    RETURN to_timestamp(v_clean, 'HH24:MI')::time;
  ELSE
    RETURN '08:30:00'::time;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN '08:30:00'::time;
END;
$$;

-- Restrict top_up_scheduled_rides_daily to service_role / cron
REVOKE EXECUTE ON FUNCTION public.top_up_scheduled_rides_daily() FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.top_up_scheduled_rides_daily() TO service_role;
