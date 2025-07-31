const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const app = express();

// ==============================
// CONFIGURAÇÕES
// ==============================
const PORT = 3000;
const SEU_IP = '192.168.0.5';

// ==============================
// MIDDLEWARES
// ==============================
app.use(cors());
app.use(bodyParser.json({ limit: '500mb' }));
app.use(express.static('public'));

// ==============================
// BANCO DE DADOS
// ==============================
const db = new sqlite3.Database('./database.db');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            senha TEXT NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS secoes (
            id_secao INTEGER PRIMARY KEY,
            id_usuario INTEGER NOT NULL,
            data_realizacao TEXT NOT NULL,
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id)
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS respostas (
            id_resposta INTEGER PRIMARY KEY AUTOINCREMENT,
            id_usuario INTEGER NOT NULL,
            id_secao INTEGER NOT NULL,
            pergunta_num INTEGER NOT NULL,
            valor_resposta INTEGER NOT NULL,
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id)
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS fotos (
            id_foto INTEGER PRIMARY KEY AUTOINCREMENT,
            id_usuario INTEGER NOT NULL,
            activity TEXT NOT NULL,
            caminho TEXT NOT NULL,
            id_secao_foto INTEGER NOT NULL,
            FOREIGN KEY (id_usuario) REFERENCES usuarios(id)
        )
    `);
    console.log("✅ Tabelas prontas!");
});

// ==============================
// ROTAS
// ==============================

// [1] Dados para frontend
app.get('/api/dados', (req, res) => {
    db.all(`
        SELECT 
            u.id as id_usuario,
            u.nome,
            u.email,
            s.id_secao,
            s.data_realizacao,
            (SELECT COUNT(*) FROM respostas WHERE id_secao = s.id_secao) as total_respostas,
            (SELECT COUNT(*) FROM fotos WHERE id_secao_foto = s.id_secao) as total_fotos
        FROM usuarios u
        LEFT JOIN secoes s ON u.id = s.id_usuario
        ORDER BY s.data_realizacao DESC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// [2] Recebe dados do Android
app.post('/api/enviar-dados', (req, res) => {
    const { id_usuario, id_secao, respostas, fotos, nome, email } = req.body;

    if (!id_usuario || !id_secao) {
        return res.status(400).json({ error: "id_usuario ou id_secao ausente" });
    }

    try {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");

            db.run(
                `INSERT OR REPLACE INTO usuarios (id, nome, email) VALUES (?, ?, ?)`,
                [id_usuario, nome || '', email || ''],
                (err) => {
                    if (err) {
                        console.error("Erro ao inserir usuário:", err);
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: "Erro ao salvar usuário" });
                    }

                    const dataLocal = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

                    db.run(
                        `INSERT INTO secoes (id_secao, id_usuario, data_realizacao) VALUES (?, ?, ?)`,
                        [id_secao, id_usuario, dataLocal],
                        (err) => {
                            if (err) {
                                console.error("Erro ao salvar seção:", err);
                                db.run("ROLLBACK");
                                return res.status(500).json({ error: "Erro ao salvar seção" });
                            }

                            if (respostas && respostas.length > 0) {
                                const stmt = db.prepare(`
                                    INSERT INTO respostas (id_usuario, id_secao, pergunta_num, valor_resposta)
                                    VALUES (?, ?, ?, ?)
                                `);
                                respostas.forEach(r => {
                                    stmt.run([id_usuario, id_secao, r.pergunta_num, r.valor_resposta]);
                                });
                                stmt.finalize();
                            }

                            if (fotos && fotos.length > 0) {
                                const pastaUploads = path.join(__dirname, 'uploads');
                                if (!fs.existsSync(pastaUploads)) fs.mkdirSync(pastaUploads);

                                const stmt = db.prepare(`
                                    INSERT INTO fotos (id_usuario, activity, caminho, id_secao_foto)
                                    VALUES (?, ?, ?, ?)
                                `);

                                fotos.forEach((foto, index) => {
                                    const nomeArquivo = `${foto.activity}_${Date.now()}_${index}.jpg`;
                                    const caminhoFinal = path.join('uploads', nomeArquivo);

                                    if (foto.base64) {
                                        const buffer = Buffer.from(foto.base64, 'base64');
                                        fs.writeFileSync(path.join(__dirname, caminhoFinal), buffer);
                                    }

                                    stmt.run([id_usuario, foto.activity, caminhoFinal, id_secao]);
                                });

                                stmt.finalize();
                            }

                            db.run("COMMIT");
                            res.json({ success: true, message: "Dados salvos com sucesso!" });
                        }
                    );
                }
            );
        });
    } catch (e) {
        console.error("Erro geral:", e);
        res.status(500).json({ success: false, message: "Erro interno no servidor" });
    }
});

// [3] Download do ZIP
app.get('/download-secao', (req, res) => {
    const { secao } = req.query;
    if (!secao) return res.status(400).send("Parâmetro 'secao' ausente");

    db.serialize(() => {
        db.get(`
            SELECT u.id as id_usuario, u.nome, u.email, s.data_realizacao
            FROM usuarios u
            JOIN secoes s ON u.id = s.id_usuario
            WHERE s.id_secao = ?
        `, [secao], (err, usuario) => {
            if (err || !usuario) {
                return res.status(500).json({ error: "Erro ao buscar usuário/seção" });
            }

            db.all(`
                SELECT pergunta_num, valor_resposta 
                FROM respostas 
                WHERE id_secao = ?
                ORDER BY pergunta_num
            `, [secao], (err, respostas) => {
                if (err) return res.status(500).json({ error: err.message });

                db.all(`
                    SELECT caminho 
                    FROM fotos 
                    WHERE id_secao_foto = ?
                `, [secao], (err, fotos) => {
                    if (err) return res.status(500).json({ error: err.message });

                    const zip = archiver('zip');
                    const nomeZip = `respostas_fotos_secao${secao.padStart(5, '0')}.zip`;
                    res.attachment(nomeZip);
                    zip.pipe(res);

                    const jsonContent = {
                        secao: parseInt(secao),
                        id_usuario: usuario.id_usuario,
                        nome: usuario.nome,
                        email: usuario.email,
                        data_geracao: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                        total_respostas: respostas.length,
                        perguntas: respostas
                    };

                    zip.append(JSON.stringify(jsonContent, null, 2), {
                        name: `respostas_secao${secao}.json`
                    });

                    fotos.forEach((foto) => {
                        const filePath = path.join(__dirname, foto.caminho);
                        if (fs.existsSync(filePath)) {
                            const fileName = path.basename(filePath);
                            zip.file(filePath, { name: `fotos/${fileName}` });
                        }
                    });

                    zip.append(
                        `RELATÓRIO DA SEÇÃO ${secao}\n\n` +
                        `Data de geração: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n` +
                        `Total de respostas: ${respostas.length}\n` +
                        `Total de fotos: ${fotos.length}\n\n` +
                        `Este arquivo contém:\n` +
                        `- respostas_secao${secao}.json\n` +
                        `- fotos/: imagens registradas na seção`,
                        { name: 'LEIA-ME.txt' }
                    );

                    zip.finalize();
                });
            });
        });
    });
});

// [4] Limpeza das tabelas
app.post('/admin/limpar-tabelas', (req, res) => {
    db.serialize(() => {
        db.run("DELETE FROM fotos");
        db.run("DELETE FROM respostas");
        db.run("DELETE FROM secoes");
        db.run("DELETE FROM usuarios");s

        const pastaUploads = path.join(__dirname, 'uploads');
        fs.readdir(pastaUploads, (err, files) => {
            if (!err && files.length > 0) {
                files.forEach(file => {
                    fs.unlink(path.join(pastaUploads, file), err => {
                        if (err) console.error("Erro ao deletar:", file, err);
                    });
                });
            }
        });

        res.json({ success: true, message: "Tabelas e fotos limpas com sucesso!" });
    });
});


// ==============================
// INICIAR SERVIDOR
// ==============================
app.listen(PORT, SEU_IP, () => {
    console.log(`
    ====================================
    🚀 API rodando em:
    - Local:  http://localhost:${PORT}
    - Rede:   http://${SEU_IP}:${PORT}
    ====================================
    `);
});
