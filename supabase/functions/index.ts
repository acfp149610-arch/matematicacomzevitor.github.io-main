
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const token = req.headers
      .get("Authorization")?.replace("Bearer ", "");

    if (!token) return json({ error: "Faça login." }, 401);

    const auth = createClient(url, anon);
    const { data: { user }, error } =
      await auth.auth.getUser(token);

    if (error || !user) {
      return json({ error: "Sessão inválida." }, 401);
    }

    const db = createClient(url, service);

    const { data: admin } = await db
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!admin) {
      return json({ error: "Acesso administrativo negado." }, 403);
    }

    const body = await req.json();
    const action = body.action;

    if (action === "users") {
      const { data, error } = await db.auth.admin.listUsers({
        page: 1,
        perPage: 1000
      });

      if (error) throw error;

      return json({
        users: data.users.map(u => ({
          id: u.id,
          email: u.email
        }))
      });
    }

    if (action === "courses") {
      const { data, error } = await db
        .from("courses")
        .select("id,title")
        .order("title");

      if (error) throw error;

      return json({ courses: data });
    }

    if (action === "lessons") {
      const { data, error } = await db
        .from("lessons")
        .select("id,title,course_id")
        .eq("course_id", body.course_id)
        .order("position");

      if (error) throw error;

      return json({ lessons: data });
    }

    if (action === "grant") {
      const { user_id, scope, content_id } = body;

      if (!user_id || !content_id ||
          !["course", "lesson"].includes(scope)) {
        return json({ error: "Dados incompletos." }, 400);
      }

      const record = {
        user_id,
        granted_by: user.id,
        active: true,
        course_id: scope === "course" ? content_id : null,
        lesson_id: scope === "lesson" ? content_id : null
      };

      const { error } = await db
        .from("manual_access_grants")
        .insert(record);

      if (error) throw error;

      return json({ success: true });
    }

    if (action === "list") {
      const { data, error } = await db
        .from("manual_access_grants")
        .select(`
          id,user_id,course_id,lesson_id,active,created_at
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return json({ grants: data });
    }

    if (action === "revoke") {
      if (!body.id) {
        return json({ error: "Liberação não informada." }, 400);
      }

      const { error } = await db
        .from("manual_access_grants")
        .update({ active: false })
        .eq("id", body.id);

      if (error) throw error;

      return json({ success: true });
    }

    return json({ error: "Ação inválida." }, 400);

  } catch (e) {
    return json({ error: e.message || "Erro interno." }, 500);
  }
});

