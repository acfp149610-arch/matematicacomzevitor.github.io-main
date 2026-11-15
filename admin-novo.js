

let sb;

const $ = id => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  const mensagem = $("msgLogin");

  try {
    if (!window.supabase) {
      throw new Error("Biblioteca do Supabase não carregada.");
    }

    if (!window.APP_CONFIG &&
        typeof APP_CONFIG === "undefined") {
      throw new Error("Arquivo config.js não carregou.");
    }

    if (!APP_CONFIG.SUPABASE_URL ||
        !APP_CONFIG.SUPABASE_ANON_KEY) {
      throw new Error("Configuração do Supabase incompleta.");
    }

    sb = window.supabase.createClient(
      APP_CONFIG.SUPABASE_URL,
      APP_CONFIG.SUPABASE_ANON_KEY
    );

    $("formAdmin").addEventListener("submit", login);

    $("sairAdmin").addEventListener("click", async () => {
      await sb.auth.signOut();
      location.reload();
    });

    $("formCurso").onsubmit = saveCourse;
    $("formPdfGratis").onsubmit = uploadFreePdf;
    $("atualizar").onclick = loadDashboard;

    const { data, error } = await sb.auth.getSession();

    if (error) throw error;

    if (data.session) {
      await verifyAdmin();
    }

  } catch (error) {
    if (mensagem) {
      mensagem.textContent = "Erro ao iniciar o painel: " + error.message;
    }
    console.error("Erro de inicialização:", error);
  }
});

async function login(e) {
  e.preventDefault();

  const form = $("formAdmin");
  const botao = form.querySelector('button[type="submit"]');
  const mensagem = $("msgLogin");

  botao.disabled = true;
  mensagem.textContent = "Verificando acesso...";

  try {
    const email = $("emailAdmin").value.trim();
    const password = $("senhaAdmin").value;

    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    if (!data.user) {
      throw new Error("Não foi possível identificar sua conta.");
    }

    await verifyAdmin();

  } catch (error) {
    mensagem.textContent = "Não foi possível entrar: " + error.message;
    console.error("Erro no login:", error);
  } finally {
    botao.disabled = false;
  }
}

async function verifyAdmin() {
  const mensagem = $("msgLogin");

  try {
    const { data: { user }, error: userError } =
      await sb.auth.getUser();

    if (userError) throw userError;

    if (!user) {
      throw new Error("Nenhum usuário autenticado.");
    }

    const { data, error } = await sb
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      await sb.auth.signOut();
      throw new Error("Esta conta não está cadastrada como administradora.");
    }

    $("loginAdmin").classList.add("hidden");
    $("painelAdmin").classList.remove("hidden");

    mensagem.textContent = "";

    await loadDashboard();

    // A liberação manual não deve impedir a abertura do painel.
    try {
      await iniciarLiberacoes();
    } catch (error) {
      console.error("Erro nas liberações:", error);
      if ($("msgAcessoManual")) {
        $("msgAcessoManual").textContent =
          "Erro ao carregar liberações: " + error.message;
      }
    }

  } catch (error) {
    $("loginAdmin").classList.remove("hidden");
    $("painelAdmin").classList.add("hidden");

    if (mensagem) mensagem.textContent = error.message;

    console.error("Erro ao verificar administrador:", error);
  }
}


// CADASTRAR CURSO
async function saveCourse(e) {
  e.preventDefault();

  const { error } = await sb.from('courses').insert({
    title: $('cursoNome').value.trim(),
    description: $('cursoDescricao').value.trim(),
    price: Number($('cursoPreco').value),
    active: true
  });

  $('msgCurso').textContent = error
    ? 'Erro: ' + error.message
    : 'Curso cadastrado com sucesso!';

  if (!error) {
    e.target.reset();
    await loadDashboard();
  }
}

// CARREGAR PAINEL
async function loadDashboard() {
  const [courses, purchases, access] = await Promise.all([
    sb.from('courses')
      .select('*')
      .order('created_at', { ascending: false }),

    sb.from('purchases')
      .select('id,student_email,course_title,amount,status,created_at')
      .order('created_at', { ascending: false })
      .limit(100),

    sb.from('enrollments')
      .select('user_id')
  ]);

  if (courses.error) {
    alert('Erro ao carregar cursos: ' + courses.error.message);
    return;
  }

  if (purchases.error) {
    alert('Erro ao carregar compras: ' + purchases.error.message);
  }

  $('qCursos').textContent =
    courses.data.filter(x => x.active).length;

  $('qCompras').textContent =
    purchases.data?.length || 0;

  $('qAlunos').textContent =
    new Set((access.data || []).map(x => x.user_id)).size;

  $('listaAdminCursos').innerHTML = '';
  await loadFreePdfs();

  for (const course of courses.data) {
    await renderCourse(course);
  }

  $('listaCompras').innerHTML = '';

  (purchases.data || []).forEach(x => {
    const item = document.createElement('div');
    item.className = 'course-row';

    const h = document.createElement('strong');
    h.textContent = x.course_title;

    const p = document.createElement('p');
    p.textContent =
      `${x.student_email} · R$ ${Number(x.amount).toFixed(2)} · ${x.status} · ${new Date(x.created_at).toLocaleString('pt-BR')}`;

    item.append(h, p);
    $('listaCompras').append(item);
  });
}

// EXIBIR E ADMINISTRAR CURSO

// EXIBIR E ADMINISTRAR CURSO
async function renderCourse(course) {
  const card = document.createElement('article');
  card.className = 'admin-card';

  const heading = document.createElement('h3');
  heading.textContent = course.title;

  const status = document.createElement('p');
  status.textContent = course.active ? 'Curso ativo' : 'Curso desativado';

  // EDITAR CURSO
  const editForm = document.createElement('form');
  editForm.className = 'field';

  const title = document.createElement('input');
  title.value = course.title;
  title.placeholder = 'Nome do curso';
  title.required = true;

  const description = document.createElement('textarea');
  description.value = course.description || '';
  description.placeholder = 'Descrição do curso';

  const price = document.createElement('input');
  price.type = 'number';
  price.step = '0.01';
  price.min = '0';
  price.value = course.price;
  price.required = true;

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn';
  save.textContent = 'Salvar alterações do curso';

  editForm.append(title, description, price, save);

  editForm.onsubmit = async e => {
    e.preventDefault();
    save.disabled = true;

    try {
      const { error } = await sb
        .from('courses')
        .update({
          title: title.value.trim(),
          description: description.value.trim(),
          price: Number(price.value)
        })
        .eq('id', course.id);

      if (error) throw error;

      alert('Curso atualizado!');
      await loadDashboard();

    } catch (error) {
      alert('Erro ao editar curso: ' + error.message);
    } finally {
      save.disabled = false;
    }
  };

  // ATIVAR OU DESATIVAR CURSO
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn secondary';
  toggle.textContent = course.active
    ? 'Desativar curso'
    : 'Ativar curso';

  toggle.onclick = async () => {
    const { error } = await sb
      .from('courses')
      .update({ active: !course.active })
      .eq('id', course.id);

    if (error) {
      alert(error.message);
    } else {
      await loadDashboard();
    }
  };

  // SEÇÃO DAS AULAS
  const lessonsTitle = document.createElement('h4');
  lessonsTitle.textContent = 'Aulas deste curso';

  const lessonsArea = document.createElement('div');

  // CADASTRAR NOVA AULA
  const newLessonTitle = document.createElement('h4');
  newLessonTitle.textContent = 'Adicionar nova aula';

  const newLessonForm = document.createElement('form');
  newLessonForm.className = 'field';

  const newLessonName = document.createElement('input');
  newLessonName.placeholder = 'Título da aula';
  newLessonName.required = true;

  const newLessonDescription = document.createElement('textarea');
  newLessonDescription.placeholder = 'Descrição da aula';

  const newLessonPosition = document.createElement('input');
  newLessonPosition.type = 'number';
  newLessonPosition.min = '1';
  newLessonPosition.value = '1';
  newLessonPosition.required = true;

  const newLessonVideo = document.createElement('input');
  newLessonVideo.type = 'file';
  newLessonVideo.accept = 'video/mp4,video/webm,video/quicktime';
  newLessonVideo.required = true;

  const newLessonButton = document.createElement('button');
  newLessonButton.type = 'submit';
  newLessonButton.className = 'btn';
  newLessonButton.textContent = 'Cadastrar aula e enviar vídeo';

  newLessonForm.append(
    newLessonName,
    newLessonDescription,
    newLessonPosition,
    newLessonVideo,
    newLessonButton
  );

  newLessonForm.onsubmit = async e => {
    e.preventDefault();

    const file = newLessonVideo.files[0];

    if (!file) {
      alert('Selecione um vídeo.');
      return;
    }

    const extensaoValida = /\.(mp4|webm|mov)$/i.test(file.name);

    if (
      !['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)
      && !extensaoValida
    ) {
      alert('Envie um vídeo MP4, WebM ou MOV.');
      return;
    }

    if (file.size > 500 * 1024 * 1024) {
      alert('O vídeo deve ter até 500 MB.');
      return;
    }

    if (!newLessonName.value.trim()) {
      alert('Informe o título da aula.');
      return;
    }

    newLessonButton.disabled = true;
    newLessonButton.textContent = 'Enviando vídeo...';

    let path = null;

    try {
      path = `${course.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      const { error: uploadError } = await sb.storage
        .from('videos-cursos')
        .upload(path, file, {
          contentType: file.type || 'video/mp4',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { error: insertError } = await sb
        .from('lessons')
        .insert({
          course_id: course.id,
          title: newLessonName.value.trim(),
          description: newLessonDescription.value.trim(),
          position: Number(newLessonPosition.value),
          video_path: path,
          active: true
        });

      if (insertError) throw insertError;

      alert('Aula cadastrada e vídeo enviado com sucesso!');
      await loadDashboard();

    } catch (error) {
      if (path) {
        await sb.storage.from('videos-cursos').remove([path]);
      }

      alert('Erro ao cadastrar aula: ' + error.message);

    } finally {
      newLessonButton.disabled = false;
      newLessonButton.textContent = 'Cadastrar aula e enviar vídeo';
    }
  };

  // CARREGAR AULAS EXISTENTES
  const { data: lessons, error: lessonsError } = await sb
    .from('lessons')
    .select('*')
    .eq('course_id', course.id)
    .order('position', { ascending: true });

  if (lessonsError) {
    lessonsArea.textContent =
      'Erro ao carregar aulas: ' + lessonsError.message;
  } else if (!lessons || lessons.length === 0) {
    lessonsArea.textContent = 'Nenhuma aula cadastrada.';
  } else {
    lessons.forEach(lesson => {
      renderLesson(lesson, lessonsArea);
    });
  }

  // PDFs DO CURSO
  const pdfTitle = document.createElement('h4');
  pdfTitle.textContent = 'Materiais em PDF deste curso';

  const pdfForm = document.createElement('form');
  pdfForm.className = 'field pdf-upload-form';

  const pdfName = document.createElement('input');
  pdfName.placeholder = 'Título do material';
  pdfName.required = true;

  const pdfDescription = document.createElement('textarea');
  pdfDescription.placeholder = 'Descrição do material (opcional)';

  const pdfFile = document.createElement('input');
  pdfFile.type = 'file';
  pdfFile.accept = 'application/pdf,.pdf';
  pdfFile.required = true;

  const pdfSubmit = document.createElement('button');
  pdfSubmit.type = 'submit';
  pdfSubmit.className = 'btn';
  pdfSubmit.textContent = 'Enviar PDF para este curso';

  pdfForm.append(pdfName, pdfDescription, pdfFile, pdfSubmit);

  pdfForm.onsubmit = async e => {
    e.preventDefault();

    const file = pdfFile.files[0];

    if (!file || (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf')) {
      alert('Selecione um arquivo PDF.');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      alert('O PDF deve ter até 50 MB.');
      return;
    }

    pdfSubmit.disabled = true;

    try {
      const path = `${course.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      const { error: uploadError } = await sb.storage
        .from('pdf-cursos')
        .upload(path, file, {
          contentType: 'application/pdf',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { error } = await sb.from('course_pdfs').insert({
        course_id: course.id,
        title: pdfName.value.trim(),
        description: pdfDescription.value.trim(),
        file_path: path,
        active: true
      });

      if (error) {
        await sb.storage.from('pdf-cursos').remove([path]);
        throw error;
      }

      alert('PDF adicionado ao curso!');
      await loadDashboard();

    } catch (error) {
      alert('Erro ao enviar PDF: ' + error.message);

    } finally {
      pdfSubmit.disabled = false;
    }
  };

  const pdfList = document.createElement('div');
  pdfList.className = 'pdf-admin-list';

  const { data: coursePdfs, error: pdfError } = await sb
    .from('course_pdfs')
    .select('*')
    .eq('course_id', course.id)
    .order('created_at', { ascending: false });

  if (pdfError) {
    pdfList.textContent = 'Erro ao carregar PDFs: ' + pdfError.message;
  } else if (!coursePdfs?.length) {
    pdfList.textContent = 'Nenhum PDF cadastrado neste curso.';
  } else {
    coursePdfs.forEach(pdf => {
      renderAdminPdf(pdf, pdfList, 'course');
    });
  }

  // MONTAR O CARTÃO DO CURSO
  card.append(
    heading,
    status,
    editForm,
    toggle,
    lessonsTitle,
    newLessonTitle,
    newLessonForm,
    lessonsArea,
    pdfTitle,
    pdfForm,
    pdfList
  );

  $('listaAdminCursos').append(card);
}

// EDITAR E EXCLUIR AULA
function renderLesson(lesson, container) {
  const box = document.createElement('div');
  box.className = 'admin-card';

  const title = document.createElement('input');
  title.value = lesson.title;
  title.placeholder = 'Título da aula';

  const description = document.createElement('textarea');
  description.value = lesson.description || '';
  description.placeholder = 'Descrição da aula';

  const position = document.createElement('input');
  position.type = 'number';
  position.min = '1';
  position.value = lesson.position;

  const videoLabel = document.createElement('label');
  videoLabel.textContent = 'Substituir vídeo (opcional)';

  const video = document.createElement('input');
  video.type = 'file';
  video.accept = 'video/mp4,video/webm,video/quicktime';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn';
  save.textContent = 'Salvar alterações da aula';

  save.onclick = async () => {
    save.disabled = true;
    save.textContent = 'Salvando...';

    try {
      const changes = {
        title: title.value.trim(),
        description: description.value.trim(),
        position: Number(position.value)
      };

      if (!changes.title || changes.position < 1) {
        throw new Error('Confira o título e a posição da aula.');
      }

      if (video.files[0]) {
        const file = video.files[0];

        if (file.size > 500 * 1024 * 1024) {
          throw new Error('O vídeo deve ter até 500 MB.');
        }

        const path =
          `${lesson.course_id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

        const { error: uploadError } = await sb.storage
          .from('videos-cursos')
          .upload(path, file, {
            contentType: file.type,
            upsert: false
          });

        if (uploadError) throw uploadError;

        changes.video_path = path;

        const { error: updateError } = await sb
          .from('lessons')
          .update(changes)
          .eq('id', lesson.id);

        if (updateError) {
          await sb.storage.from('videos-cursos').remove([path]);
          throw updateError;
        }

        if (lesson.video_path) {
          await sb.storage
            .from('videos-cursos')
            .remove([lesson.video_path]);
        }
      } else {
        const { error } = await sb
          .from('lessons')
          .update(changes)
          .eq('id', lesson.id);

        if (error) throw error;
      }

      alert('Aula atualizada com sucesso!');
      await loadDashboard();

    } catch (error) {
      alert('Erro ao editar aula: ' + error.message);
    }

    save.disabled = false;
    save.textContent = 'Salvar alterações da aula';
  };

  // ATIVAR OU DESATIVAR AULA
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn secondary';

  toggle.textContent = lesson.active
    ? 'Desativar aula'
    : 'Ativar aula';

  toggle.onclick = async () => {
    const { error } = await sb
      .from('lessons')
      .update({ active: !lesson.active })
      .eq('id', lesson.id);

    if (error) {
      alert(error.message);
    } else {
      await loadDashboard();
    }
  };

  // EXCLUIR AULA
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn secondary';
  remove.textContent = 'Excluir aula';

  remove.onclick = async () => {
    if (!confirm(
      `Deseja realmente excluir a aula "${lesson.title}"?`
    )) return;

    const { error } = await sb
      .from('lessons')
      .delete()
      .eq('id', lesson.id);

    if (error) {
      alert('Erro ao excluir aula: ' + error.message);
      return;
    }

    if (lesson.video_path) {
      const { error: storageError } = await sb.storage
        .from('videos-cursos')
        .remove([lesson.video_path]);

      if (storageError) {
        alert('Aula excluída, mas não foi possível apagar o vídeo: ' + storageError.message);
      }
    }

    await loadDashboard();
  };

  const label = document.createElement('p');
  label.textContent = `Aula ${lesson.position} · ${lesson.active ? 'Ativa' : 'Desativada'}`;

  box.append(
    label,
    title,
    description,
    position,
    videoLabel,
    video,
    save,
    toggle,
    remove
  );

  container.append(box);
}


// BIBLIOTECA DE PDFS GRATUITOS
async function uploadFreePdf(e) {
  e.preventDefault();
  const file = $('pdfGratisArquivo').files[0];
  if (!file || (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf')) {
    $('msgPdfGratis').textContent = 'Selecione um arquivo PDF.';
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    $('msgPdfGratis').textContent = 'O PDF deve ter até 50 MB.';
    return;
  }
  $('msgPdfGratis').textContent = 'Enviando PDF...';
  try {
    const path = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const { error: uploadError } = await sb.storage.from('pdf-gratuitos').upload(path, file, { contentType: 'application/pdf', upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await sb.from('free_pdfs').insert({
      title: $('pdfGratisTitulo').value.trim(),
      description: $('pdfGratisDescricao').value.trim(),
      file_path: path,
      active: true
    });
    if (error) {
      await sb.storage.from('pdf-gratuitos').remove([path]);
      throw error;
    }
    $('formPdfGratis').reset();
    $('msgPdfGratis').textContent = 'PDF publicado com sucesso!';
    await loadFreePdfs();
  } catch (err) {
    $('msgPdfGratis').textContent = 'Erro: ' + err.message;
  }
}

async function loadFreePdfs() {
  const box = $('listaPdfsGratis');
  if (!box) return;
  const { data, error } = await sb.from('free_pdfs').select('*').order('created_at', { ascending: false });
  box.innerHTML = '';
  if (error) {
    box.textContent = 'Erro ao carregar biblioteca: ' + error.message;
    return;
  }
  if (!data?.length) {
    box.textContent = 'Nenhum PDF gratuito publicado.';
    return;
  }
  data.forEach(pdf => renderAdminPdf(pdf, box, 'free'));
}

function renderAdminPdf(pdf, container, type) {
  const box = document.createElement('article');
  box.className = 'pdf-admin-item';
  const title = document.createElement('input');
  title.value = pdf.title;
  title.placeholder = 'Título';
  const description = document.createElement('textarea');
  description.value = pdf.description || '';
  description.placeholder = 'Descrição';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'application/pdf,.pdf';
  const status = document.createElement('p');
  status.textContent = pdf.active ? 'Publicado' : 'Desativado';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn';
  save.textContent = 'Salvar PDF';
  save.onclick = async () => {
    save.disabled = true;
    try {
      const bucket = type === 'free' ? 'pdf-gratuitos' : 'pdf-cursos';
      const changes = { title: title.value.trim(), description: description.value.trim() };
      if (!changes.title) throw new Error('Informe o título.');
      let newPath = null;
      if (file.files[0]) {
        const f = file.files[0];
        if (f.size > 50 * 1024 * 1024) throw new Error('O PDF deve ter até 50 MB.');
        if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) throw new Error('Selecione um PDF.');
        newPath = `${type === 'free' ? '' : pdf.course_id + '/'}${crypto.randomUUID()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const { error: upErr } = await sb.storage.from(bucket).upload(newPath, f, { contentType: 'application/pdf', upsert: false });
        if (upErr) throw upErr;
        changes.file_path = newPath;
      }
      const table = type === 'free' ? 'free_pdfs' : 'course_pdfs';
      const { error } = await sb.from(table).update(changes).eq('id', pdf.id);
      if (error) {
        if (newPath) await sb.storage.from(bucket).remove([newPath]);
        throw error;
      }
      if (newPath && pdf.file_path) await sb.storage.from(bucket).remove([pdf.file_path]);
      alert('PDF atualizado!');
      await loadDashboard();
    } catch (err) {
      alert('Erro ao salvar PDF: ' + err.message);
    } finally {
      save.disabled = false;
    }
  };
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn secondary';
  toggle.textContent = pdf.active ? 'Desativar' : 'Publicar';
  toggle.onclick = async () => {
    const table = type === 'free' ? 'free_pdfs' : 'course_pdfs';
    const { error } = await sb.from(table).update({ active: !pdf.active }).eq('id', pdf.id);
    if (error) alert(error.message);
    else await loadDashboard();
  };
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn secondary';
  remove.textContent = 'Excluir PDF';
  remove.onclick = async () => {
    if (!confirm(`Excluir o PDF "${pdf.title}"?`)) return;
    const table = type === 'free' ? 'free_pdfs' : 'course_pdfs';
    const bucket = type === 'free' ? 'pdf-gratuitos' : 'pdf-cursos';
    const { error } = await sb.from(table).delete().eq('id', pdf.id);
    if (error) { alert(error.message); return; }
    if (pdf.file_path) await sb.storage.from(bucket).remove([pdf.file_path]);
    await loadDashboard();
  };
  box.append(status, title, description, file, save, toggle, remove);
  container.append(box);
}


async function chamarGestaoAcessos(body) {
  const { data, error } = await sb.functions.invoke(
    "gestao-acessos",
    { body }
  );

  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  return data;
}

async function iniciarLiberacoes() {
  const aluno = $("alunoAcesso");
  const curso = $("cursoAcesso");

  if (!aluno || !curso) return;

  try {
    const [users, courses] = await Promise.all([
      chamarGestaoAcessos({ action: "users" }),
      chamarGestaoAcessos({ action: "courses" })
    ]);

    aluno.innerHTML = '<option value="">Selecione um aluno</option>';

    users.users.forEach(u => {
      const option = document.createElement("option");
      option.value = u.id;
      option.textContent = u.email;
      aluno.append(option);
    });

    curso.innerHTML = '<option value="">Selecione um curso</option>';

    courses.courses.forEach(c => {
      const option = document.createElement("option");
      option.value = c.id;
      option.textContent = c.title;
      curso.append(option);
    });

    curso.onchange = carregarAulasLiberacao;

    $("formAcessoManual").onsubmit = liberarAcessoManual;

    await carregarAcessosManuais();

  } catch (error) {
    $("msgAcessoManual").textContent =
      "Erro ao carregar dados: " + error.message;
  }
}

async function carregarAulasLiberacao() {
  const aula = $("aulaAcesso");

  aula.innerHTML = '<option value="">Carregando aulas...</option>';

  try {
    const result = await chamarGestaoAcessos({
      action: "lessons",
      course_id: $("cursoAcesso").value
    });

    aula.innerHTML = '<option value="">Selecione uma aula</option>';

    result.lessons.forEach(l => {
      const option = document.createElement("option");
      option.value = l.id;
      option.textContent = l.title;
      aula.append(option);
    });

    if (!result.lessons.length) {
      aula.innerHTML = '<option value="">Nenhuma aula ativa</option>';
    }

  } catch (error) {
    aula.innerHTML = '<option value="">Erro ao carregar aulas</option>';
    $("msgAcessoManual").textContent = error.message;
  }
}

async function liberarAcessoManual(e) {
  e.preventDefault();

  const user_id = $("alunoAcesso").value;
  const lesson_id = $("aulaAcesso").value;

  if (!user_id || !$("cursoAcesso").value || !lesson_id) {
    $("msgAcessoManual").textContent =
      "Selecione o aluno, o curso e a aula.";
    return;
  }

  const button = e.target.querySelector("button");
  button.disabled = true;

  $("msgAcessoManual").textContent = "Liberando acesso...";

  try {
    await chamarGestaoAcessos({
      action: "grant",
      user_id,
      lesson_id
    });

    $("msgAcessoManual").textContent =
      "Acesso gratuito liberado com sucesso!";

    e.target.reset();

    $("aulaAcesso").innerHTML =
      '<option value="">Selecione uma aula</option>';

    await carregarAcessosManuais();

  } catch (error) {
    $("msgAcessoManual").textContent =
      "Erro: " + error.message;
  } finally {
    button.disabled = false;
  }
}

async function carregarAcessosManuais() {
  const box = $("listaAcessosManuais");

  try {
    const result = await chamarGestaoAcessos({
      action: "list"
    });

    box.innerHTML = "";

    if (!result.grants.length) {
      box.textContent = "Nenhum acesso gratuito liberado.";
      return;
    }

    result.grants.forEach(g => {
      const item = document.createElement("article");
      item.className = "course-row";

      const title = document.createElement("strong");
      title.textContent = g.email;

      const lesson = g.lessons;
      const course = lesson?.courses;

      const detail = document.createElement("p");
      detail.textContent =
        `${course?.title || "Curso"} · ${lesson?.title || "Aula"}`;

      const status = document.createElement("p");
      status.textContent = g.active
        ? "Acesso ativo"
        : "Acesso revogado";

      item.append(title, detail, status);

      if (g.active) {
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "btn secondary";
        revoke.textContent = "Revogar acesso";

        revoke.onclick = async () => {
          if (!confirm("Deseja revogar este acesso?")) return;

          revoke.disabled = true;

          try {
            await chamarGestaoAcessos({
              action: "revoke",
              id: g.id
            });

            await carregarAcessosManuais();

          } catch (error) {
            alert("Erro: " + error.message);
            revoke.disabled = false;
          }
        };

        item.append(revoke);
      }

      box.append(item);
    });

  } catch (error) {
    box.textContent = "Erro ao carregar acessos: " + error.message;
  }
}


